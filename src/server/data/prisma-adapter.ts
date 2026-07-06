import { randomUUID } from "node:crypto";
import { billingPlans } from "@/server/billing/plans";
import type { BillingOrder } from "@/types/billing";
import type { AccountEntitlement, ImageAsset, ImageGenerationTask } from "@/types/image";
import type { EditableSelectableImageModel, ModelConfigurationTestStatus } from "@/types/model-config";
import type { AppRepositories } from "./repositories";
import type { ActiveImageModelConfigurationRecord, CreditLedgerEntryRecord, ModelConfigurationChangeRecord } from "./records";

type RecordValue = string | number | bigint | boolean | null | Date | Record<string, unknown> | Array<unknown>;
type DbRecord = Record<string, RecordValue | undefined>;

interface PrismaDelegate {
  findMany: (args?: Record<string, unknown>) => Promise<DbRecord[]>;
  findUnique?: (args: Record<string, unknown>) => Promise<DbRecord | null>;
  findFirst?: (args: Record<string, unknown>) => Promise<DbRecord | null>;
  create: (args: Record<string, unknown>) => Promise<DbRecord>;
  update?: (args: Record<string, unknown>) => Promise<DbRecord>;
  updateMany?: (args: Record<string, unknown>) => Promise<{ count: number }>;
  count?: (args?: Record<string, unknown>) => Promise<number>;
}

interface PrismaClientLike {
  $transaction?: <T>(fn: (client: PrismaClientLike) => Promise<T>) => Promise<T>;
  $executeRawUnsafe?: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe?: (query: string, ...values: unknown[]) => Promise<DbRecord[]>;
  user: PrismaDelegate;
  userCredential: PrismaDelegate;
  userSession: PrismaDelegate;
  authRateLimitBucket: PrismaDelegate;
  creditBucket: PrismaDelegate;
  creditLedgerEntry: PrismaDelegate;
  creditHold: PrismaDelegate;
  order: PrismaDelegate;
  paymentNotification: PrismaDelegate;
  imageUpload: PrismaDelegate;
  imageTask: PrismaDelegate;
  providerSubmission: PrismaDelegate;
  providerResult: PrismaDelegate;
  imageAsset: PrismaDelegate;
  assetVersionNode: PrismaDelegate;
  downloadEvent: PrismaDelegate;
  assetCleanupJob: PrismaDelegate;
  activeImageModelConfiguration?: PrismaDelegate;
  modelConfigurationChange?: PrismaDelegate;
}

let prismaClientPromise: Promise<PrismaClientLike> | undefined;
let testPrismaClient: PrismaClientLike | undefined;
let modelConfigTablesEnsured = false;

export function setPrismaClientForTesting(client: PrismaClientLike | undefined) {
  testPrismaClient = client;
  prismaClientPromise = undefined;
  modelConfigTablesEnsured = false;
}

async function getPrismaClient(): Promise<PrismaClientLike> {
  if (testPrismaClient) return testPrismaClient;
  if (!prismaClientPromise) {
    prismaClientPromise = (async () => {
      const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ PrismaClient: new () => PrismaClientLike }>;
      const prismaModule = await dynamicImport("@prisma/client");
      return new prismaModule.PrismaClient();
    })();
  }
  return prismaClientPromise;
}

async function runTransaction<T>(prisma: PrismaClientLike, fn: (client: PrismaClientLike) => Promise<T>) {
  return prisma.$transaction ? prisma.$transaction(fn) : fn(prisma);
}

function toIso(value: RecordValue | undefined) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function asString(value: RecordValue | undefined, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function fitVarchar(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

function imageTaskStatusTimestampField(status: string) {
  if (status === "running") return "runningAt";
  if (status === "storing") return "storingAt";
  if (status === "reviewing") return "reviewingAt";
  if (status === "succeeded") return "completedAt";
  if (status === "failed" || status === "refunded") return "failedAt";
  return undefined;
}

function asNumber(value: RecordValue | undefined, fallback = 0) {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : fallback;
}

function asJsonObject(value: RecordValue | undefined): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value) ? value : {};
}

function entitlementSnapshotFromRecord(value: RecordValue | undefined): ImageAsset["entitlementSnapshot"] {
  const snapshot = asJsonObject(value);
  const memberStatus = snapshot.memberStatus;
  if (
    (memberStatus !== "free" && memberStatus !== "credit_pack") ||
    typeof snapshot.capturedAt !== "string" ||
    typeof snapshot.canDownloadHd !== "boolean" ||
    typeof snapshot.canDownloadWithoutWatermark !== "boolean"
  ) {
    return undefined;
  }

  return {
    memberStatus,
    capturedAt: snapshot.capturedAt,
    canDownloadHd: snapshot.canDownloadHd,
    canDownloadWithoutWatermark: snapshot.canDownloadWithoutWatermark
  };
}

function accountFromUser(user: DbRecord, credits: number, username: string): AccountEntitlement {
  const memberStatus = asString(user.memberStatus, "free") as AccountEntitlement["memberStatus"];

  return {
    userId: asString(user.id),
    username,
    displayName: asString(user.displayName, "FluxArt User"),
    credits,
    memberStatus,
    preferredImageModelId: asString(user.preferredImageModelId) || undefined,
    canUseOutpaint: memberStatus === "credit_pack",
    canDownloadHd: memberStatus === "credit_pack",
    canDownloadWithoutWatermark: memberStatus === "credit_pack"
  };
}

function assetFromRecord(record: DbRecord): ImageAsset {
  const reviewStatus = asString(record.reviewStatus, "approved");
  const deletedAt = record.deletedAt ? toIso(record.deletedAt) : undefined;
  const status = reviewStatus === "approved" || reviewStatus === "skipped" ? "succeeded" : reviewStatus === "rejected" ? "failed" : "reviewing";

  return {
    id: asString(record.id),
    userId: asString(record.userId),
    title: asString(record.title, "FluxArt asset"),
    origin: asString(record.origin, "generated") as ImageAsset["origin"],
    taskId: asString(record.taskId) || undefined,
    taskType: (asString(record.taskType) || undefined) as ImageAsset["taskType"],
    status,
    prompt: asString(record.prompt),
    imageUrl: asString(record.publicUrl),
    objectKey: asString(record.objectKey),
    publicUrl: asString(record.publicUrl),
    mimeType: asString(record.mimeType),
    sizeBytes: asNumber(record.sizeBytes),
    width: asNumber(record.width),
    height: asNumber(record.height),
    reviewStatus: reviewStatus as ImageAsset["reviewStatus"],
    sourceAssetId: asString(record.sourceAssetId) || undefined,
    downloadState: asString(record.downloadState, "not_downloaded") as ImageAsset["downloadState"],
    modelProvider: asString(record.modelProvider),
    modelName: asString(record.modelName),
    entitlementSnapshot: entitlementSnapshotFromRecord(record.entitlementSnapshotJson),
    deletedAt,
    createdAt: toIso(record.createdAt)
  };
}

function taskFromRecord(record: DbRecord): ImageGenerationTask {
  const resultAssetIds = Array.isArray(record.assets)
    ? record.assets.map(asset => asString((asset as DbRecord).id)).filter(Boolean)
    : [];
  return {
    id: asString(record.id),
    userId: asString(record.userId),
    taskType: asString(record.taskType, "t2i") as ImageGenerationTask["taskType"],
    status: asString(record.state, "queued") as ImageGenerationTask["status"],
    prompt: asString(record.prompt),
    negativePrompt: asString(record.negativePrompt) || undefined,
    requestPayload: asJsonObject(record.requestPayloadJson),
    modelProvider: asString(record.provider),
    modelName: asString(record.modelName),
    sourceAssetId: asString(record.sourceAssetId) || undefined,
    chargedCredits: asNumber(record.costCredits),
    priority: asNumber(record.priority),
    creditHoldId: asString(record.creditHoldId) || undefined,
    resultAssetIds,
    errorMessage: asString(record.failureReason) || undefined,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt)
  };
}

function orderToBillingOrder(record: DbRecord, creditsAfterPayment: number, memberStatusAfterPayment: AccountEntitlement["memberStatus"]): BillingOrder {
  return {
    orderId: asString(record.id),
    planId: asString(record.planId, "credits-1500") as BillingOrder["planId"],
    userId: asString(record.userId),
    status: asString(record.status, "pending_payment") as BillingOrder["status"],
    fulfillmentStatus: asString(record.fulfillmentStatus, "pending") as BillingOrder["fulfillmentStatus"],
    outTradeNo: asString(record.outTradeNo),
    amountCents: asNumber(record.amountCents),
    currency: "CNY",
    paymentUrl: asString(record.paymentUrl) || undefined,
    creditsAfterPayment,
    memberStatusAfterPayment,
    createdAt: toIso(record.createdAt)
  };
}

function bucketFromRecord(record: DbRecord): Awaited<ReturnType<AppRepositories["credits"]["listBuckets"]>>[number] {
  return {
    id: asString(record.id),
    userId: asString(record.userId),
    sourceType: asString(record.sourceType, "adjustment") as "registration" | "daily_free" | "purchased" | "adjustment",
    creditType: asString(record.creditType, "promotional") as "promotional" | "purchased",
    originalAmount: asNumber(record.originalAmount),
    remainingAmount: asNumber(record.remainingAmount),
    validFrom: toIso(record.validFrom),
    validUntil: record.validUntil ? toIso(record.validUntil) : undefined,
    priority: asNumber(record.priority),
    sourceOrderId: asString(record.sourceOrderId) || undefined,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt)
  };
}

function modelTestStatus(value: RecordValue | undefined): ModelConfigurationTestStatus {
  const status = asString(value, "untested");
  return status === "passed" || status === "failed" ? status : "untested";
}

function editableModelConfigFromRecord(record: DbRecord): EditableSelectableImageModel {
  return {
    id: asString(record.id, "active"),
    displayName: asString(record.displayName, "Default Image Model"),
    provider: asString(record.provider, "agnes"),
    model: asString(record.modelName, "agnes-image-2.1-flash"),
    baseUrl: asString(record.baseUrl, "https://apihub.agnes-ai.com/v1"),
    apiKeySecretRef: asString(record.apiKeySecretRef, "FLUXART_IMAGE_API_KEY"),
    executionMode: asString(record.executionMode, "mock") === "live" ? "live" : "mock",
    requestTimeoutMs: asNumber(record.requestTimeoutMs, 120000),
    enabled: record.enabled !== false,
    isDefault: record.isDefault === true || asString(record.id) === "active"
  };
}

function activeModelConfigFromRecord(record: DbRecord): ActiveImageModelConfigurationRecord {
  return {
    ...editableModelConfigFromRecord(record),
    lastTestStatus: modelTestStatus(record.lastTestStatus),
    lastTestedAt: record.lastTestedAt ? toIso(record.lastTestedAt) : undefined,
    lastTestError: asString(record.lastTestError) || undefined,
    updatedByUserId: asString(record.updatedByUserId) || undefined,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt)
  };
}

function editableModelConfigFromJsonObject(config: Record<string, unknown>): EditableSelectableImageModel {
  return {
    id: typeof config.id === "string" ? config.id : "active",
    displayName: typeof config.displayName === "string" ? config.displayName : "Default Image Model",
    provider: typeof config.provider === "string" ? config.provider : "agnes",
    model: typeof config.model === "string" ? config.model : "agnes-image-2.1-flash",
    baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : "https://apihub.agnes-ai.com/v1",
    apiKeySecretRef: typeof config.apiKeySecretRef === "string" ? config.apiKeySecretRef : "FLUXART_IMAGE_API_KEY",
    executionMode: config.executionMode === "live" ? "live" : "mock",
    requestTimeoutMs: typeof config.requestTimeoutMs === "number" ? config.requestTimeoutMs : 120000,
    enabled: typeof config.enabled === "boolean" ? config.enabled : true,
    isDefault: typeof config.isDefault === "boolean" ? config.isDefault : config.id === "active"
  };
}

function editableModelConfigListFromJson(value: RecordValue | undefined): EditableSelectableImageModel[] | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return editableModelConfigListFromJson(parsed as RecordValue);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === "object" && item !== null).map(item => editableModelConfigFromJsonObject(item as Record<string, unknown>));
  }
  const config = asJsonObject(value);
  if (!Object.keys(config).length) return undefined;
  return [editableModelConfigFromJsonObject(config)];
}

function modelConfigurationChangeFromRecord(record: DbRecord): ModelConfigurationChangeRecord {
  return {
    id: asString(record.id),
    changedByUserId: asString(record.changedByUserId),
    changeType: asString(record.changeType, "save") === "restore" ? "restore" : "save",
    beforeConfig: editableModelConfigListFromJson(record.beforeConfigJson),
    afterConfig: editableModelConfigListFromJson(record.afterConfigJson) || [editableModelConfigFromJsonObject({})],
    testStatus: modelTestStatus(record.testStatus),
    testError: asString(record.testError) || undefined,
    restoredFromChangeId: asString(record.restoredFromChangeId) || undefined,
    createdAt: toIso(record.createdAt)
  };
}

type RawSqlPrismaClient = PrismaClientLike & {
  $executeRawUnsafe: NonNullable<PrismaClientLike["$executeRawUnsafe"]>;
  $queryRawUnsafe: NonNullable<PrismaClientLike["$queryRawUnsafe"]>;
};

const activeModelConfigurationSelect = `
  SELECT
    id,
    display_name AS displayName,
    provider,
    model_name AS modelName,
    base_url AS baseUrl,
    api_key_secret_ref AS apiKeySecretRef,
    execution_mode AS executionMode,
    request_timeout_ms AS requestTimeoutMs,
    enabled,
    is_default AS isDefault,
    last_test_status AS lastTestStatus,
    last_tested_at AS lastTestedAt,
    last_test_error AS lastTestError,
    updated_by_user_id AS updatedByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM active_image_model_configurations
`;

const modelConfigurationChangeSelect = `
  SELECT
    id,
    active_configuration_id AS activeConfigurationId,
    changed_by_user_id AS changedByUserId,
    change_type AS changeType,
    before_config_json AS beforeConfigJson,
    after_config_json AS afterConfigJson,
    test_status AS testStatus,
    test_error AS testError,
    restored_from_change_id AS restoredFromChangeId,
    created_at AS createdAt
  FROM model_configuration_changes
`;

const createActiveModelConfigurationTableSql = `
  CREATE TABLE IF NOT EXISTS \`active_image_model_configurations\` (
    \`id\` VARCHAR(64) NOT NULL,
    \`display_name\` VARCHAR(120) NOT NULL DEFAULT 'Default Image Model',
    \`provider\` VARCHAR(64) NOT NULL,
    \`model_name\` VARCHAR(120) NOT NULL,
    \`base_url\` VARCHAR(512) NOT NULL,
    \`api_key_secret_ref\` VARCHAR(128) NOT NULL,
    \`execution_mode\` VARCHAR(16) NOT NULL,
    \`request_timeout_ms\` INT NOT NULL,
    \`enabled\` BOOLEAN NOT NULL DEFAULT true,
    \`is_default\` BOOLEAN NOT NULL DEFAULT false,
    \`last_test_status\` VARCHAR(16) NOT NULL DEFAULT 'untested',
    \`last_tested_at\` DATETIME(3) NULL,
    \`last_test_error\` VARCHAR(512) NULL,
    \`updated_by_user_id\` VARCHAR(191) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`id\`)
  )
`;

const createModelConfigurationChangesTableSql = `
  CREATE TABLE IF NOT EXISTS \`model_configuration_changes\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`active_configuration_id\` VARCHAR(64) NOT NULL DEFAULT 'active',
    \`changed_by_user_id\` VARCHAR(191) NOT NULL,
    \`change_type\` VARCHAR(16) NOT NULL,
    \`before_config_json\` JSON NULL,
    \`after_config_json\` JSON NOT NULL,
    \`test_status\` VARCHAR(16) NOT NULL DEFAULT 'untested',
    \`test_error\` VARCHAR(512) NULL,
    \`restored_from_change_id\` VARCHAR(191) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`id\`),
    KEY \`model_config_changes_active_created_idx\` (\`active_configuration_id\`, \`created_at\`),
    KEY \`model_config_changes_created_idx\` (\`created_at\`),
    CONSTRAINT \`model_configuration_changes_active_configuration_id_fkey\` FOREIGN KEY (\`active_configuration_id\`) REFERENCES \`active_image_model_configurations\`(\`id\`)
  )
`;

function requireModelConfigRawSql(client: PrismaClientLike): RawSqlPrismaClient {
  if (!client.$executeRawUnsafe || !client.$queryRawUnsafe) {
    throw new Error("Prisma client does not expose model configuration delegates or raw SQL support. Run `npx prisma generate` after applying the latest schema.");
  }
  return client as RawSqlPrismaClient;
}

async function ensureModelConfigTables(client: RawSqlPrismaClient) {
  if (modelConfigTablesEnsured) return;
  await client.$executeRawUnsafe(createActiveModelConfigurationTableSql);
  await client.$executeRawUnsafe(createModelConfigurationChangesTableSql);
  modelConfigTablesEnsured = true;
}

async function maybeEnsureModelConfigTables(client: PrismaClientLike) {
  if (client.$executeRawUnsafe && client.$queryRawUnsafe) {
    await ensureModelConfigTables(client as RawSqlPrismaClient);
  }
}

function jsonColumnValue(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

async function findActiveModelConfigurationRecord(client: PrismaClientLike) {
  const records = await listActiveModelConfigurationRecords(client);
  return records.find(record => record.enabled !== false && record.isDefault === true)
    || records.find(record => record.enabled !== false)
    || records[0]
    || null;
}

async function listActiveModelConfigurationRecords(client: PrismaClientLike) {
  await maybeEnsureModelConfigTables(client);
  if (client.activeImageModelConfiguration?.findMany) {
    return client.activeImageModelConfiguration.findMany({ orderBy: { createdAt: "asc" } });
  }

  const rawClient = requireModelConfigRawSql(client);
  return rawClient.$queryRawUnsafe(`${activeModelConfigurationSelect} ORDER BY created_at ASC`);
}

async function saveSelectableModelConfigurationRecords(client: PrismaClientLike, models: DbRecord[]) {
  const delegate = client.activeImageModelConfiguration;
  const ids = models.map(model => asString(model.id)).filter(Boolean);
  if (delegate) {
    if (delegate.updateMany && ids.length) {
      await delegate.updateMany({ where: { id: { notIn: ids } }, data: { enabled: false } });
    }
    const saved: DbRecord[] = [];
    for (const model of models) {
      const existing = delegate.findUnique ? await delegate.findUnique({ where: { id: model.id } }) : null;
      const { createdAt, ...updateData } = model;
      const record = existing && delegate.update
        ? await delegate.update({ where: { id: model.id }, data: updateData })
        : await delegate.create({ data: { ...model, createdAt: createdAt || model.updatedAt } });
      saved.push(record);
    }
    return saved;
  }

  const rawClient = requireModelConfigRawSql(client);
  if (ids.length) {
    await rawClient.$executeRawUnsafe(
      `UPDATE active_image_model_configurations SET enabled = false WHERE id NOT IN (${ids.map(() => "?").join(", ")})`,
      ...ids
    );
  }
  for (const data of models) {
    const createdAt = data.createdAt || data.updatedAt;
    const isDefault = data.isDefault ? 1 : 0;
    const enabled = data.enabled ? 1 : 0;
  await rawClient.$executeRawUnsafe(
    `INSERT INTO active_image_model_configurations (
       id,
       display_name,
       provider,
       model_name,
       base_url,
       api_key_secret_ref,
       execution_mode,
       request_timeout_ms,
       enabled,
       is_default,
       last_test_status,
       last_tested_at,
       last_test_error,
       updated_by_user_id,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       provider = VALUES(provider),
       model_name = VALUES(model_name),
       base_url = VALUES(base_url),
       api_key_secret_ref = VALUES(api_key_secret_ref),
       execution_mode = VALUES(execution_mode),
       request_timeout_ms = VALUES(request_timeout_ms),
       enabled = VALUES(enabled),
       is_default = VALUES(is_default),
       last_test_status = VALUES(last_test_status),
       last_tested_at = VALUES(last_tested_at),
       last_test_error = VALUES(last_test_error),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_at = VALUES(updated_at)`,
    data.id,
    data.displayName,
    data.provider,
    data.modelName,
    data.baseUrl,
    data.apiKeySecretRef,
    data.executionMode,
    data.requestTimeoutMs,
    enabled,
    isDefault,
    data.lastTestStatus,
    data.lastTestedAt,
    data.lastTestError,
    data.updatedByUserId,
    createdAt || data.updatedAt,
    data.updatedAt
  );
  }

  return listActiveModelConfigurationRecords(client);
}

async function updateActiveModelConfigurationTestResultRecord(
  client: PrismaClientLike,
  input: {
    testStatus: ModelConfigurationTestStatus;
    testedAt: string;
    testError?: string;
    updatedByUserId?: string;
    modelId?: string;
  }
) {
  const modelId = input.modelId || "active";
  await maybeEnsureModelConfigTables(client);
  if (client.activeImageModelConfiguration?.update) {
    return client.activeImageModelConfiguration.update({
      where: { id: modelId },
      data: {
        lastTestStatus: input.testStatus,
        lastTestedAt: input.testedAt,
        lastTestError: input.testError || null,
        updatedByUserId: input.updatedByUserId || null,
        updatedAt: input.testedAt
      }
    });
  }

  const rawClient = requireModelConfigRawSql(client);
  await rawClient.$executeRawUnsafe(
    `UPDATE active_image_model_configurations
     SET last_test_status = ?,
         last_tested_at = ?,
         last_test_error = ?,
         updated_by_user_id = ?,
         updated_at = ?
     WHERE id = ?`,
    input.testStatus,
    input.testedAt,
    input.testError || null,
    input.updatedByUserId || null,
    input.testedAt,
    modelId
  );
  const [record] = await rawClient.$queryRawUnsafe(`${activeModelConfigurationSelect} WHERE id = ? LIMIT 1`, modelId);
  return record || null;
}

async function createModelConfigurationChangeRecord(client: PrismaClientLike, data: DbRecord) {
  await maybeEnsureModelConfigTables(client);
  if (client.modelConfigurationChange) {
    return client.modelConfigurationChange.create({ data });
  }

  const rawClient = requireModelConfigRawSql(client);
  await rawClient.$executeRawUnsafe(
    `INSERT INTO model_configuration_changes (
       id,
       active_configuration_id,
       changed_by_user_id,
       change_type,
       before_config_json,
       after_config_json,
       test_status,
       test_error,
       restored_from_change_id,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.id,
    data.activeConfigurationId,
    data.changedByUserId,
    data.changeType,
    jsonColumnValue(data.beforeConfigJson),
    jsonColumnValue(data.afterConfigJson),
    data.testStatus,
    data.testError,
    data.restoredFromChangeId,
    data.createdAt
  );
  const [record] = await rawClient.$queryRawUnsafe(`${modelConfigurationChangeSelect} WHERE id = ? LIMIT 1`, data.id);
  return record || data;
}

async function listModelConfigurationChangeRecords(client: PrismaClientLike, limit: number) {
  await maybeEnsureModelConfigTables(client);
  if (client.modelConfigurationChange) {
    return client.modelConfigurationChange.findMany({
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.min(Math.trunc(limit), 100)) : 10;
  const rawClient = requireModelConfigRawSql(client);
  return rawClient.$queryRawUnsafe(
    `${modelConfigurationChangeSelect}
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`
  );
}

async function findModelConfigurationChangeRecord(client: PrismaClientLike, changeId: string) {
  await maybeEnsureModelConfigTables(client);
  if (client.modelConfigurationChange?.findUnique) {
    return client.modelConfigurationChange.findUnique({ where: { id: changeId } });
  }

  const rawClient = requireModelConfigRawSql(client);
  const [record] = await rawClient.$queryRawUnsafe(`${modelConfigurationChangeSelect} WHERE id = ? LIMIT 1`, changeId);
  return record || null;
}

export function createPrismaRepositories(): AppRepositories {
  return {
    image: {
      async listAssets(options = {}) {
        const prisma = await getPrismaClient();
        const records = await prisma.imageAsset.findMany({
          where: {
            ...(options.userId ? { userId: options.userId } : {}),
            ...(options.includeDeleted ? {} : { deletedAt: null })
          },
          orderBy: { createdAt: "desc" }
        });
        return records.map(assetFromRecord);
      },
      async getAsset(assetId) {
        const prisma = await getPrismaClient();
        const record = await prisma.imageAsset.findUnique?.({ where: { id: assetId } });
        return record ? assetFromRecord(record) : undefined;
      },
      async createAsset(asset) {
        const prisma = await getPrismaClient();
        const record = await prisma.imageAsset.create({
          data: {
            id: asset.id,
            taskId: asset.taskId || null,
            userId: asset.userId,
            origin: asset.origin,
            title: asset.title,
            taskType: asset.taskType || null,
            prompt: asset.prompt,
            objectKey: asset.objectKey,
            publicUrl: asset.publicUrl,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            width: asset.width,
            height: asset.height,
            reviewStatus: asset.reviewStatus,
            downloadState: asset.downloadState,
            modelProvider: String(asset.modelProvider),
            modelName: asset.modelName,
            sourceAssetId: asset.sourceAssetId || null,
            entitlementSnapshotJson: asset.entitlementSnapshot || undefined
          }
        });
        return assetFromRecord(record);
      },
      async updateAsset(assetId, patch) {
        const prisma = await getPrismaClient();
        const data: Record<string, unknown> = { ...patch };
        delete data.status;
        delete data.imageUrl;
        const record = await prisma.imageAsset.update?.({ where: { id: assetId }, data });
        return record ? assetFromRecord(record) : undefined;
      },
      async softDeleteAsset(assetId, deletedAt) {
        const prisma = await getPrismaClient();
        const record = await prisma.imageAsset.update?.({ where: { id: assetId }, data: { deletedAt } });
        return record ? assetFromRecord(record) : undefined;
      },
      async listTasks(options = {}) {
        const prisma = await getPrismaClient();
        const records = await prisma.imageTask.findMany({
          where: options.userId ? { userId: options.userId } : undefined,
          include: { assets: { select: { id: true } } },
          orderBy: { createdAt: "desc" }
        });
        return records.map(taskFromRecord);
      },
      async getTask(taskId) {
        const prisma = await getPrismaClient();
        const record = await prisma.imageTask.findUnique?.({ where: { id: taskId }, include: { assets: { select: { id: true } } } });
        return record ? taskFromRecord(record) : undefined;
      },
      async createTask(taskInput) {
        const prisma = await getPrismaClient();
        const record = await prisma.imageTask.create({
          data: "id" in taskInput
            ? {
              id: taskInput.id,
              userId: taskInput.userId,
              taskType: taskInput.taskType,
              prompt: taskInput.prompt,
              negativePrompt: taskInput.negativePrompt || null,
              requestPayloadJson: taskInput.requestPayload,
              provider: String(taskInput.modelProvider),
              modelName: taskInput.modelName,
              state: taskInput.status,
              priority: taskInput.priority || 10,
              costCredits: taskInput.chargedCredits,
              sourceAssetId: taskInput.sourceAssetId || null,
              creditHoldId: taskInput.creditHoldId || null
            }
            : {
              userId: taskInput.userId,
              taskType: taskInput.taskType,
              prompt: taskInput.prompt,
              negativePrompt: taskInput.negativePrompt || null,
              requestPayloadJson: taskInput.requestPayload,
              provider: taskInput.modelProvider,
              modelName: taskInput.modelName,
              state: taskInput.status,
              priority: taskInput.priority,
              costCredits: taskInput.chargedCredits,
              sourceAssetId: taskInput.sourceAssetId || null,
              creditHoldId: taskInput.creditHoldId || null
            }
        });
        return taskFromRecord(record);
      },
      async updateTask(taskId, patch) {
        const prisma = await getPrismaClient();
        const data: Record<string, unknown> = { ...patch };
        if (patch.status) {
          data.state = patch.status;
          const timestampField = imageTaskStatusTimestampField(patch.status);
          if (timestampField) data[timestampField] = new Date();
          delete data.status;
        }
        if (patch.requestPayload && typeof patch.requestPayload === "object") {
          data.requestPayloadJson = patch.requestPayload;
          delete data.requestPayload;
        }
        if (typeof patch.errorMessage === "string") {
          data.failureReason = fitVarchar(patch.errorMessage, 255);
        }
        delete data.errorCode;
        delete data.errorMessage;
        delete data.resultAssetIds;
        const record = await prisma.imageTask.update?.({
          where: { id: taskId },
          data,
          include: { assets: { select: { id: true } } }
        });
        return record ? taskFromRecord(record) : undefined;
      },
      async listVersionNodes() {
        const prisma = await getPrismaClient();
        const records = await prisma.assetVersionNode.findMany({ orderBy: { createdAt: "asc" } });
        return records.map(record => ({
          id: asString(record.id),
          label: asString(record.label),
          assetId: asString(record.assetId)
        }));
      },
      async createUpload(upload) {
        const prisma = await getPrismaClient();
        const record = await prisma.imageUpload.create({ data: upload });
        return {
          id: asString(record.id),
          userId: asString(record.userId),
          kind: asString(record.kind, "source") as "source" | "mask",
          objectKey: asString(record.objectKey),
          publicUrl: asString(record.publicUrl),
          mimeType: asString(record.mimeType),
          sizeBytes: asNumber(record.sizeBytes),
          width: asNumber(record.width),
          height: asNumber(record.height),
          validationStatus: asString(record.validationStatus, "accepted") as "accepted" | "rejected",
          failureReason: asString(record.failureReason) || undefined,
          createdAt: toIso(record.createdAt)
        };
      },
      async listUploads(userId) {
        const prisma = await getPrismaClient();
        const records = await prisma.imageUpload.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
        return records.map(record => ({
          id: asString(record.id),
          userId: asString(record.userId),
          kind: asString(record.kind, "source") as "source" | "mask",
          objectKey: asString(record.objectKey),
          publicUrl: asString(record.publicUrl),
          mimeType: asString(record.mimeType),
          sizeBytes: asNumber(record.sizeBytes),
          width: asNumber(record.width),
          height: asNumber(record.height),
          validationStatus: asString(record.validationStatus, "accepted") as "accepted" | "rejected",
          failureReason: asString(record.failureReason) || undefined,
          createdAt: toIso(record.createdAt)
        }));
      },
      async createAssetCleanupJob(job) {
        const prisma = await getPrismaClient();
        const record = await prisma.assetCleanupJob.create({ data: job });
        return {
          id: asString(record.id),
          assetId: asString(record.assetId),
          objectKey: asString(record.objectKey),
          reason: asString(record.reason, "soft_deleted") as "soft_deleted" | "retention_expired",
          scheduledAt: toIso(record.scheduledAt),
          completedAt: record.completedAt ? toIso(record.completedAt) : undefined,
          createdAt: toIso(record.createdAt)
        };
      },
      async createProviderSubmission(submission) {
        const prisma = await getPrismaClient();
        const record = await prisma.providerSubmission.create({
          data: {
            id: submission.id,
            taskId: submission.taskId,
            provider: submission.provider,
            modelName: submission.modelName,
            providerMode: submission.providerMode,
            requestMetadataJson: submission.requestMetadata,
            externalTaskId: submission.externalTaskId || null,
            createdAt: submission.createdAt
          }
        });
        return { ...submission, id: asString(record.id, submission.id) };
      },
      async createProviderResult(result) {
        const prisma = await getPrismaClient();
        const record = await prisma.providerResult.create({
          data: {
            id: result.id,
            submissionId: result.submissionId,
            status: result.status,
            rawPayloadDigest: result.rawPayloadDigest,
            outputMetadataJson: result.outputMetadata,
            errorMetadataJson: result.errorMetadata,
            createdAt: result.createdAt
          }
        });
        return { ...result, id: asString(record.id, result.id) };
      }
    },
    account: {
      async getCurrentAccount(userId = "") {
        const prisma = await getPrismaClient();
        const user = userId
          ? await prisma.user.findUnique?.({ where: { id: userId } })
          : await prisma.user.findFirst?.({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
        if (!user) throw new Error("No account is available");
        const credential = await prisma.userCredential.findUnique?.({ where: { userId: asString(user.id) } });
        const nowIso = new Date().toISOString();
        const buckets = await prisma.creditBucket.findMany({ where: { userId: asString(user.id) } });
        const credits = buckets
          .filter(bucket => toIso(bucket.validFrom) <= nowIso && (!bucket.validUntil || toIso(bucket.validUntil) > nowIso))
          .reduce((sum, bucket) => sum + asNumber(bucket.remainingAmount), 0);
        return accountFromUser(user, credits, asString(credential?.username));
      },
      async getUserById(userId) {
        const prisma = await getPrismaClient();
        const user = await prisma.user.findUnique?.({ where: { id: userId } });
        if (!user) return undefined;
        return {
          id: asString(user.id),
          username: asString((await prisma.userCredential.findUnique?.({ where: { userId } }))?.username),
          displayName: asString(user.displayName),
          status: asString(user.status, "active") as "active" | "disabled",
          memberStatus: asString(user.memberStatus, "free") as AccountEntitlement["memberStatus"],
          preferredImageModelId: asString(user.preferredImageModelId) || undefined,
          createdAt: toIso(user.createdAt),
          updatedAt: toIso(user.updatedAt)
        };
      },
      async getUserByUsername(username) {
        const prisma = await getPrismaClient();
        const credential = await prisma.userCredential.findUnique?.({ where: { username } });
        if (!credential) return undefined;
        return this.getUserById(asString(credential.userId));
      },
      async createUser(input) {
        const prisma = await getPrismaClient();
        const user = await prisma.user.create({
          data: {
            displayName: input.displayName,
            memberStatus: input.memberStatus || "free"
          }
        });
        return {
          id: asString(user.id),
          username: input.username,
          displayName: asString(user.displayName),
          status: asString(user.status, "active") as "active" | "disabled",
          memberStatus: asString(user.memberStatus, "free") as AccountEntitlement["memberStatus"],
          preferredImageModelId: asString(user.preferredImageModelId) || undefined,
          createdAt: toIso(user.createdAt),
          updatedAt: toIso(user.updatedAt)
        };
      },
      async updateMemberStatus(userId, memberStatus) {
        const prisma = await getPrismaClient();
        const user = await prisma.user.update?.({ where: { id: userId }, data: { memberStatus } });
        if (!user) return undefined;
        return {
          id: asString(user.id),
          username: asString((await prisma.userCredential.findUnique?.({ where: { userId } }))?.username),
          displayName: asString(user.displayName),
          status: asString(user.status, "active") as "active" | "disabled",
          memberStatus: asString(user.memberStatus, "free") as AccountEntitlement["memberStatus"],
          preferredImageModelId: asString(user.preferredImageModelId) || undefined,
          createdAt: toIso(user.createdAt),
          updatedAt: toIso(user.updatedAt)
        };
      },
      async updatePreferredImageModel(userId, preferredImageModelId) {
        const prisma = await getPrismaClient();
        const user = await prisma.user.update?.({ where: { id: userId }, data: { preferredImageModelId: preferredImageModelId || null } });
        if (!user) return undefined;
        return {
          id: asString(user.id),
          username: asString((await prisma.userCredential.findUnique?.({ where: { userId } }))?.username),
          displayName: asString(user.displayName),
          status: asString(user.status, "active") as "active" | "disabled",
          memberStatus: asString(user.memberStatus, "free") as AccountEntitlement["memberStatus"],
          preferredImageModelId: asString(user.preferredImageModelId) || undefined,
          createdAt: toIso(user.createdAt),
          updatedAt: toIso(user.updatedAt)
        };
      }
    },
    auth: {
      async getCredentialByUsername(username) {
        const prisma = await getPrismaClient();
        const record = await prisma.userCredential.findUnique?.({ where: { username } });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          username: asString(record.username),
          passwordHash: asString(record.passwordHash),
          hashVersion: asString(record.hashVersion, "scrypt-v1"),
          passwordChangedAt: toIso(record.passwordChangedAt)
        } : undefined;
      },
      async getCredentialByUserId(userId) {
        const prisma = await getPrismaClient();
        const record = await prisma.userCredential.findUnique?.({ where: { userId } });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          username: asString(record.username),
          passwordHash: asString(record.passwordHash),
          hashVersion: asString(record.hashVersion, "scrypt-v1"),
          passwordChangedAt: toIso(record.passwordChangedAt)
        } : undefined;
      },
      async createRegistration(input) {
        const prisma = await getPrismaClient();
        return runTransaction(prisma, async tx => {
          const userRecord = await tx.user.create({
            data: {
              displayName: input.user.displayName,
              memberStatus: input.user.memberStatus
            }
          });
          const user = {
            id: asString(userRecord.id),
            username: input.user.username,
            displayName: asString(userRecord.displayName),
            status: asString(userRecord.status, "active") as "active" | "disabled",
            memberStatus: asString(userRecord.memberStatus, "free") as AccountEntitlement["memberStatus"],
            createdAt: toIso(userRecord.createdAt),
            updatedAt: toIso(userRecord.updatedAt)
          };
          const credential = {
            ...input.credential,
            userId: user.id,
            username: input.user.username
          };
          const creditBucket = {
            ...input.creditBucket,
            userId: user.id
          };
          const ledgerEntry = {
            ...input.ledgerEntry,
            userId: user.id,
            bucketId: creditBucket.id,
            sourceRefId: input.ledgerEntry.sourceRefId || user.id
          };
          const session = {
            ...input.session,
            userId: user.id
          };

          await tx.userCredential.create({ data: credential });
          await tx.creditBucket.create({ data: creditBucket });
          await tx.creditLedgerEntry.create({ data: ledgerEntry });
          await tx.userSession.create({
            data: {
              id: session.id,
              userId: session.userId,
              tokenHash: session.tokenHash,
              slidingExpires: session.slidingExpiresAt,
              absoluteExpires: session.absoluteExpiresAt,
              revokedAt: session.revokedAt || null,
              userAgent: session.userAgent || null,
              ipAddress: session.ipAddress || null,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt
            }
          });

          return { user, credential, creditBucket, ledgerEntry, session };
        });
      },
      async createCredential(credential) {
        const prisma = await getPrismaClient();
        await prisma.userCredential.create({ data: credential });
        return credential;
      },
      async updatePasswordHash(userId, passwordHash, passwordChangedAt) {
        const prisma = await getPrismaClient();
        const record = await prisma.userCredential.update?.({ where: { userId }, data: { passwordHash, passwordChangedAt } });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          username: asString(record.username),
          passwordHash: asString(record.passwordHash),
          hashVersion: asString(record.hashVersion, "scrypt-v1"),
          passwordChangedAt: toIso(record.passwordChangedAt)
        } : undefined;
      },
      async createSession(session) {
        const prisma = await getPrismaClient();
        await prisma.userSession.create({
          data: {
            id: session.id,
            userId: session.userId,
            tokenHash: session.tokenHash,
            slidingExpires: session.slidingExpiresAt,
            absoluteExpires: session.absoluteExpiresAt,
            revokedAt: session.revokedAt || null,
            userAgent: session.userAgent || null,
            ipAddress: session.ipAddress || null,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt
          }
        });
        return session;
      },
      async getSessionByTokenHash(tokenHash) {
        const prisma = await getPrismaClient();
        const record = await prisma.userSession.findUnique?.({ where: { tokenHash } });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          tokenHash: asString(record.tokenHash),
          slidingExpiresAt: toIso(record.slidingExpires),
          absoluteExpiresAt: toIso(record.absoluteExpires),
          revokedAt: record.revokedAt ? toIso(record.revokedAt) : undefined,
          userAgent: asString(record.userAgent) || undefined,
          ipAddress: asString(record.ipAddress) || undefined,
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        } : undefined;
      },
      async touchSession(sessionId, slidingExpiresAt) {
        const prisma = await getPrismaClient();
        const record = await prisma.userSession.update?.({ where: { id: sessionId }, data: { slidingExpires: slidingExpiresAt } });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          tokenHash: asString(record.tokenHash),
          slidingExpiresAt: toIso(record.slidingExpires),
          absoluteExpiresAt: toIso(record.absoluteExpires),
          revokedAt: record.revokedAt ? toIso(record.revokedAt) : undefined,
          userAgent: asString(record.userAgent) || undefined,
          ipAddress: asString(record.ipAddress) || undefined,
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        } : undefined;
      },
      async revokeSession(sessionId, revokedAt) {
        const prisma = await getPrismaClient();
        const record = await prisma.userSession.update?.({ where: { id: sessionId }, data: { revokedAt } });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          tokenHash: asString(record.tokenHash),
          slidingExpiresAt: toIso(record.slidingExpires),
          absoluteExpiresAt: toIso(record.absoluteExpires),
          revokedAt: record.revokedAt ? toIso(record.revokedAt) : undefined,
          userAgent: asString(record.userAgent) || undefined,
          ipAddress: asString(record.ipAddress) || undefined,
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        } : undefined;
      },
      async revokeUserSessions(userId, revokedAt) {
        const prisma = await getPrismaClient();
        const sessions = await prisma.userSession.findMany({ where: { userId, revokedAt: null } });
        await Promise.all(sessions.map(session => prisma.userSession.update?.({ where: { id: session.id }, data: { revokedAt } })));
        return sessions.length;
      },
      async listActiveSessions(userId, nowIso) {
        const prisma = await getPrismaClient();
        const records = await prisma.userSession.findMany({
          where: { userId, revokedAt: null, slidingExpires: { gt: nowIso }, absoluteExpires: { gt: nowIso } },
          orderBy: { createdAt: "asc" }
        });
        return records.map(record => ({
          id: asString(record.id),
          userId: asString(record.userId),
          tokenHash: asString(record.tokenHash),
          slidingExpiresAt: toIso(record.slidingExpires),
          absoluteExpiresAt: toIso(record.absoluteExpires),
          revokedAt: record.revokedAt ? toIso(record.revokedAt) : undefined,
          userAgent: asString(record.userAgent) || undefined,
          ipAddress: asString(record.ipAddress) || undefined,
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        }));
      },
      async consumeRateLimit(input) {
        const prisma = await getPrismaClient();
        const now = new Date(input.now);
        const resetAt = new Date(input.resetAt);
        if (prisma.$executeRawUnsafe && prisma.$queryRawUnsafe) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO auth_rate_limit_buckets (id, scope, count, reset_at, updated_at)
             VALUES (?, ?, 1, ?, ?)
             ON DUPLICATE KEY UPDATE
               count = IF(reset_at <= ?, 1, count + 1),
               reset_at = IF(reset_at <= ?, VALUES(reset_at), reset_at),
               updated_at = VALUES(updated_at)`,
            `rate-${randomUUID()}`,
            input.scope,
            resetAt,
            now,
            now,
            now
          );
          const [record] = await prisma.$queryRawUnsafe(
            "SELECT id, scope, count, reset_at AS resetAt, updated_at AS updatedAt FROM auth_rate_limit_buckets WHERE scope = ? LIMIT 1",
            input.scope
          );
          const count = asNumber(record?.count);
          return {
            id: asString(record?.id),
            scope: asString(record?.scope, input.scope),
            count,
            resetAt: toIso(record?.resetAt),
            updatedAt: toIso(record?.updatedAt),
            allowed: count <= input.maxAttempts
          };
        }

        const existing = await prisma.authRateLimitBucket.findUnique?.({ where: { scope: input.scope } });
        if (!existing || toIso(existing.resetAt) <= input.now) {
          try {
            const record = existing
              ? await prisma.authRateLimitBucket.update?.({
              where: { scope: input.scope },
              data: { count: 1, resetAt, updatedAt: now }
              })
              : await prisma.authRateLimitBucket.create({
              data: {
                scope: input.scope,
                count: 1,
                resetAt,
                updatedAt: now
              }
              });
            return {
              id: asString(record?.id),
              scope: input.scope,
              count: 1,
              resetAt: input.resetAt,
              updatedAt: input.now,
              allowed: true
            };
          } catch {
            const record = await prisma.authRateLimitBucket.update?.({
              where: { scope: input.scope },
              data: { count: { increment: 1 }, updatedAt: now }
            });
            const count = asNumber(record?.count);
            return {
              id: asString(record?.id),
              scope: input.scope,
              count,
              resetAt: toIso(record?.resetAt),
              updatedAt: input.now,
              allowed: count <= input.maxAttempts
            };
          }
        }

        const record = await prisma.authRateLimitBucket.update?.({
          where: { scope: input.scope },
          data: { count: { increment: 1 }, updatedAt: input.now }
        });
        const count = asNumber(record?.count, asNumber(existing.count) + 1);
        return {
          id: asString(record?.id, asString(existing.id)),
          scope: input.scope,
          count,
          resetAt: toIso(record?.resetAt || existing.resetAt),
          updatedAt: input.now,
          allowed: count <= input.maxAttempts
        };
      }
    },
    credits: {
      async listBuckets(userId) {
        const prisma = await getPrismaClient();
        const records = await prisma.creditBucket.findMany({ where: { userId } });
        return records.map(bucketFromRecord);
      },
      async listLedgerEntries(userId, limit = 20) {
        const prisma = await getPrismaClient();
        const records = await prisma.creditLedgerEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
        return records.map(record => ({
          id: asString(record.id),
          userId: asString(record.userId),
          bucketId: asString(record.bucketId) || undefined,
          holdId: asString(record.holdId) || undefined,
          entryType: asString(record.entryType, "adjustment") as "grant" | "hold" | "spend" | "refund" | "release" | "adjustment",
          amount: asNumber(record.amount),
          balanceAfter: asNumber(record.balanceAfter),
          sourceRefType: asString(record.sourceRefType),
          sourceRefId: asString(record.sourceRefId) || undefined,
          label: asString(record.label, asString(record.entryType)),
          createdAt: toIso(record.createdAt)
        }));
      },
      async createBucket(bucket) {
        const prisma = await getPrismaClient();
        await prisma.creditBucket.create({ data: bucket });
        return bucket;
      },
      async updateBucket(bucketId, patch) {
        const prisma = await getPrismaClient();
        const record = await prisma.creditBucket.update?.({ where: { id: bucketId }, data: patch });
        return record ? { ...(patch as typeof patch), id: asString(record.id), userId: asString(record.userId) } as Awaited<ReturnType<AppRepositories["credits"]["listBuckets"]>>[number] : undefined;
      },
      async createLedgerEntry(entry) {
        const prisma = await getPrismaClient();
        await prisma.creditLedgerEntry.create({ data: entry });
        return entry;
      },
      async createDailyFreeGrant(input) {
        const prisma = await getPrismaClient();
        const run = prisma.$transaction || (async fn => fn(prisma));
        try {
          return await run(async tx => {
            await tx.creditBucket.create({ data: input.bucket });
            await tx.creditLedgerEntry.create({ data: input.ledgerEntry });
            return input;
          });
        } catch {
          return undefined;
        }
      },
      async reserveCredits(input) {
        const prisma = await getPrismaClient();
        return runTransaction(prisma, async tx => {
          const now = input.now;
          const nowDate = new Date(input.now);
          const rawBuckets = tx.$queryRawUnsafe
            ? await tx.$queryRawUnsafe(
              `SELECT id, user_id AS userId, source_type AS sourceType, credit_type AS creditType,
                      original_amount AS originalAmount, remaining_amount AS remainingAmount,
                      valid_from AS validFrom, valid_until AS validUntil, priority,
                      source_order_id AS sourceOrderId,
                      created_at AS createdAt, updated_at AS updatedAt
               FROM credit_buckets
               WHERE user_id = ? AND remaining_amount > 0 AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)
               ORDER BY priority ASC, COALESCE(valid_until, '9999-12-31') ASC, created_at ASC
              FOR UPDATE`,
              input.userId,
              nowDate,
              nowDate
            )
            : await tx.creditBucket.findMany({ where: { userId: input.userId } });
          const buckets = rawBuckets
            .map(bucketFromRecord)
            .filter(bucket => bucket.remainingAmount > 0 && bucket.validFrom <= now && (!bucket.validUntil || bucket.validUntil > now))
            .sort((left, right) => left.priority - right.priority || (left.validUntil || "9999").localeCompare(right.validUntil || "9999") || left.createdAt.localeCompare(right.createdAt));
          const available = buckets.reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
          if (available < input.amount) throw new Error("INSUFFICIENT_CREDITS");

          const hold = {
            id: input.holdId,
            userId: input.userId,
            amount: input.amount,
            status: "active" as const,
            taskId: input.taskId,
            downloadId: input.downloadId,
            expiresAt: input.expiresAt,
            createdAt: input.now,
            updatedAt: input.now
          };
          await tx.creditHold.create({ data: hold });

          const ledgerEntries: Awaited<ReturnType<AppRepositories["credits"]["reserveCredits"]>>["ledgerEntries"] = [];
          let remaining = input.amount;
          let balanceAfter = available;

          for (const bucket of buckets) {
            if (remaining <= 0) break;
            const deduction = Math.min(bucket.remainingAmount, remaining);
            if (tx.$executeRawUnsafe) {
              await tx.$executeRawUnsafe(
                "UPDATE credit_buckets SET remaining_amount = remaining_amount - ?, updated_at = ? WHERE id = ?",
                deduction,
                nowDate,
                bucket.id
              );
            } else {
              await tx.creditBucket.update?.({ where: { id: bucket.id }, data: { remainingAmount: bucket.remainingAmount - deduction, updatedAt: input.now } });
            }
            remaining -= deduction;
            balanceAfter -= deduction;
            const ledgerEntry = {
              id: `ledger-${randomUUID()}`,
              userId: input.userId,
              bucketId: bucket.id,
              holdId: hold.id,
              entryType: "hold" as const,
              amount: -deduction,
              balanceAfter,
              sourceRefType: input.taskId ? "image_task" : input.downloadId ? "download" : "credit_hold",
              sourceRefId: input.taskId || input.downloadId || hold.id,
              label: input.label,
              createdAt: input.now
            };
            await tx.creditLedgerEntry.create({ data: ledgerEntry });
            ledgerEntries.push(ledgerEntry);
          }

          return { hold, ledgerEntries };
        });
      },
      async finalizeHoldSpend(input) {
        const prisma = await getPrismaClient();
        return runTransaction(prisma, async tx => {
          const holdRecord = await tx.creditHold.findUnique?.({ where: { id: input.holdId } });
          if (!holdRecord || asString(holdRecord.status) !== "active") return undefined;
          const hold = {
            id: asString(holdRecord.id),
            userId: asString(holdRecord.userId),
            amount: asNumber(holdRecord.amount),
            status: "spent" as const,
            taskId: asString(holdRecord.taskId) || undefined,
            downloadId: asString(holdRecord.downloadId) || undefined,
            expiresAt: toIso(holdRecord.expiresAt),
            convertedAt: input.now,
            createdAt: toIso(holdRecord.createdAt),
            updatedAt: input.now
          };
          const holdLedgerRecords = await tx.creditLedgerEntry.findMany({ where: { holdId: input.holdId, entryType: "hold" } });
          const buckets = await tx.creditBucket.findMany({ where: { userId: hold.userId } });
          const balanceAfter = buckets
            .map(bucketFromRecord)
            .filter(bucket => bucket.remainingAmount > 0 && bucket.validFrom <= input.now && (!bucket.validUntil || bucket.validUntil > input.now))
            .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
          const ledgerEntries: CreditLedgerEntryRecord[] = [];

          for (const holdEntry of holdLedgerRecords) {
            const ledgerEntry = {
              id: `ledger-${randomUUID()}`,
              userId: hold.userId,
              bucketId: asString(holdEntry.bucketId) || undefined,
              holdId: hold.id,
              entryType: "spend" as const,
              amount: asNumber(holdEntry.amount),
              balanceAfter,
              sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
              sourceRefId: hold.taskId || hold.downloadId || hold.id,
              label: input.label,
              createdAt: input.now
            };
            await tx.creditLedgerEntry.create({ data: ledgerEntry });
            ledgerEntries.push(ledgerEntry);
          }

          await tx.creditHold.update?.({ where: { id: input.holdId }, data: { status: "spent", convertedAt: input.now, updatedAt: input.now } });
          return { hold, ledgerEntries };
        });
      },
      async settleHoldPartially(input) {
        const prisma = await getPrismaClient();
        return runTransaction(prisma, async tx => {
          const nowDate = new Date(input.now);
          const holdRecord = await tx.creditHold.findUnique?.({ where: { id: input.holdId } });
          if (!holdRecord || asString(holdRecord.status) !== "active") return undefined;
          const hold = {
            id: asString(holdRecord.id),
            userId: asString(holdRecord.userId),
            amount: asNumber(holdRecord.amount),
            status: "spent" as const,
            taskId: asString(holdRecord.taskId) || undefined,
            downloadId: asString(holdRecord.downloadId) || undefined,
            expiresAt: toIso(holdRecord.expiresAt),
            convertedAt: input.now,
            createdAt: toIso(holdRecord.createdAt),
            updatedAt: input.now
          };
          const holdLedgerRecords = await tx.creditLedgerEntry.findMany({ where: { holdId: input.holdId, entryType: "hold" } });
          const buckets = await tx.creditBucket.findMany({ where: { userId: hold.userId } });
          let remainingSpend = Math.max(0, Math.min(input.spendAmount, hold.amount));
          let balanceAfter = buckets
            .map(bucketFromRecord)
            .filter(bucket => bucket.remainingAmount > 0 && bucket.validFrom <= input.now && (!bucket.validUntil || bucket.validUntil > input.now))
            .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
          const ledgerEntries: CreditLedgerEntryRecord[] = [];

          for (const holdEntry of holdLedgerRecords) {
            const bucketId = asString(holdEntry.bucketId) || undefined;
            const heldAmount = Math.abs(asNumber(holdEntry.amount));
            const spendAmount = Math.min(heldAmount, remainingSpend);
            const releaseAmount = heldAmount - spendAmount;
            remainingSpend -= spendAmount;

            if (spendAmount > 0) {
              const ledgerEntry = {
                id: `ledger-${randomUUID()}`,
                userId: hold.userId,
                bucketId,
                holdId: hold.id,
                entryType: "spend" as const,
                amount: -spendAmount,
                balanceAfter,
                sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
                sourceRefId: hold.taskId || hold.downloadId || hold.id,
                label: input.spendLabel,
                createdAt: input.now
              };
              await tx.creditLedgerEntry.create({ data: ledgerEntry });
              ledgerEntries.push(ledgerEntry);
            }

            if (releaseAmount > 0) {
              if (bucketId) {
                if (tx.$executeRawUnsafe) {
                  await tx.$executeRawUnsafe("UPDATE credit_buckets SET remaining_amount = remaining_amount + ?, updated_at = ? WHERE id = ?", releaseAmount, nowDate, bucketId);
                } else {
                  await tx.creditBucket.update?.({ where: { id: bucketId }, data: { remainingAmount: { increment: releaseAmount }, updatedAt: input.now } });
                }
                balanceAfter += releaseAmount;
              }
              const ledgerEntry = {
                id: `ledger-${randomUUID()}`,
                userId: hold.userId,
                bucketId,
                holdId: hold.id,
                entryType: "release" as const,
                amount: releaseAmount,
                balanceAfter,
                sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
                sourceRefId: hold.taskId || hold.downloadId || hold.id,
                label: input.releaseLabel,
                createdAt: input.now
              };
              await tx.creditLedgerEntry.create({ data: ledgerEntry });
              ledgerEntries.push(ledgerEntry);
            }
          }

          await tx.creditHold.update?.({ where: { id: input.holdId }, data: { status: "spent", convertedAt: input.now, updatedAt: input.now } });
          return { hold, ledgerEntries };
        });
      },
      async releaseHold(input) {
        const prisma = await getPrismaClient();
        return runTransaction(prisma, async tx => {
          const nowDate = new Date(input.now);
          const holdRecord = await tx.creditHold.findUnique?.({ where: { id: input.holdId } });
          if (!holdRecord || asString(holdRecord.status) !== "active") return undefined;
          const hold = {
            id: asString(holdRecord.id),
            userId: asString(holdRecord.userId),
            amount: asNumber(holdRecord.amount),
            status: "released" as const,
            taskId: asString(holdRecord.taskId) || undefined,
            downloadId: asString(holdRecord.downloadId) || undefined,
            expiresAt: toIso(holdRecord.expiresAt),
            releasedAt: input.now,
            createdAt: toIso(holdRecord.createdAt),
            updatedAt: input.now
          };
          const holdLedgerRecords = await tx.creditLedgerEntry.findMany({ where: { holdId: input.holdId, entryType: "hold" } });
          const buckets = await tx.creditBucket.findMany({ where: { userId: hold.userId } });
          let balanceAfter = buckets
            .map(bucketFromRecord)
            .filter(bucket => bucket.remainingAmount > 0 && bucket.validFrom <= input.now && (!bucket.validUntil || bucket.validUntil > input.now))
            .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
          const ledgerEntries: CreditLedgerEntryRecord[] = [];

          for (const holdEntry of holdLedgerRecords) {
            const bucketId = asString(holdEntry.bucketId);
            if (!bucketId) continue;
            const releaseAmount = Math.abs(asNumber(holdEntry.amount));
            if (tx.$executeRawUnsafe) {
              await tx.$executeRawUnsafe(
                "UPDATE credit_buckets SET remaining_amount = remaining_amount + ?, updated_at = ? WHERE id = ?",
                releaseAmount,
                nowDate,
                bucketId
              );
            } else {
              const bucket = buckets.map(bucketFromRecord).find(item => item.id === bucketId);
              await tx.creditBucket.update?.({ where: { id: bucketId }, data: { remainingAmount: (bucket?.remainingAmount || 0) + releaseAmount, updatedAt: input.now } });
            }
            balanceAfter += releaseAmount;
            const ledgerEntry = {
              id: `ledger-${randomUUID()}`,
              userId: hold.userId,
              bucketId,
              holdId: hold.id,
              entryType: "release" as const,
              amount: releaseAmount,
              balanceAfter,
              sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
              sourceRefId: hold.taskId || hold.downloadId || hold.id,
              label: input.label,
              createdAt: input.now
            };
            await tx.creditLedgerEntry.create({ data: ledgerEntry });
            ledgerEntries.push(ledgerEntry);
          }

          await tx.creditHold.update?.({ where: { id: input.holdId }, data: { status: "released", releasedAt: input.now, updatedAt: input.now } });
          return { hold, ledgerEntries };
        });
      },
      async refundHold(input) {
        const prisma = await getPrismaClient();
        return runTransaction(prisma, async tx => {
          const nowDate = new Date(input.now);
          const holdRecord = await tx.creditHold.findUnique?.({ where: { id: input.holdId } });
          if (!holdRecord || asString(holdRecord.status) !== "spent") return undefined;
          const hold = {
            id: asString(holdRecord.id),
            userId: asString(holdRecord.userId),
            amount: asNumber(holdRecord.amount),
            status: "refunded" as const,
            taskId: asString(holdRecord.taskId) || undefined,
            downloadId: asString(holdRecord.downloadId) || undefined,
            expiresAt: toIso(holdRecord.expiresAt),
            convertedAt: holdRecord.convertedAt ? toIso(holdRecord.convertedAt) : undefined,
            refundedAt: input.now,
            createdAt: toIso(holdRecord.createdAt),
            updatedAt: input.now
          };
          const holdLedgerRecords = await tx.creditLedgerEntry.findMany({ where: { holdId: input.holdId, entryType: "hold" } });
          const buckets = await tx.creditBucket.findMany({ where: { userId: hold.userId } });
          let balanceAfter = buckets
            .map(bucketFromRecord)
            .filter(bucket => bucket.remainingAmount > 0 && bucket.validFrom <= input.now && (!bucket.validUntil || bucket.validUntil > input.now))
            .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
          const ledgerEntries: CreditLedgerEntryRecord[] = [];

          for (const holdEntry of holdLedgerRecords) {
            const bucketId = asString(holdEntry.bucketId);
            if (!bucketId) continue;
            const refundAmount = Math.abs(asNumber(holdEntry.amount));
            if (tx.$executeRawUnsafe) {
              await tx.$executeRawUnsafe(
                "UPDATE credit_buckets SET remaining_amount = remaining_amount + ?, updated_at = ? WHERE id = ?",
                refundAmount,
                nowDate,
                bucketId
              );
            } else {
              const bucket = buckets.map(bucketFromRecord).find(item => item.id === bucketId);
              await tx.creditBucket.update?.({ where: { id: bucketId }, data: { remainingAmount: (bucket?.remainingAmount || 0) + refundAmount, updatedAt: input.now } });
            }
            balanceAfter += refundAmount;
            const ledgerEntry = {
              id: `ledger-${randomUUID()}`,
              userId: hold.userId,
              bucketId,
              holdId: hold.id,
              entryType: "refund" as const,
              amount: refundAmount,
              balanceAfter,
              sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
              sourceRefId: hold.taskId || hold.downloadId || hold.id,
              label: input.label,
              createdAt: input.now
            };
            await tx.creditLedgerEntry.create({ data: ledgerEntry });
            ledgerEntries.push(ledgerEntry);
          }

          await tx.creditHold.update?.({ where: { id: input.holdId }, data: { status: "refunded", refundedAt: input.now, updatedAt: input.now } });
          return { hold, ledgerEntries };
        });
      },
      async createAdjustment(input) {
        const prisma = await getPrismaClient();
        return runTransaction(prisma, async tx => {
          const nowDate = new Date(input.now);
          const rawBuckets = tx.$queryRawUnsafe
            ? await tx.$queryRawUnsafe(
              `SELECT id, user_id AS userId, source_type AS sourceType, credit_type AS creditType,
                      original_amount AS originalAmount, remaining_amount AS remainingAmount,
                      valid_from AS validFrom, valid_until AS validUntil, priority,
                      source_order_id AS sourceOrderId,
                      created_at AS createdAt, updated_at AS updatedAt
               FROM credit_buckets
               WHERE user_id = ? AND remaining_amount > 0 AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)
               ORDER BY priority ASC, COALESCE(valid_until, '9999-12-31') ASC, created_at ASC
              FOR UPDATE`,
              input.userId,
              nowDate,
              nowDate
            )
            : await tx.creditBucket.findMany({ where: { userId: input.userId } });
          const buckets = rawBuckets
            .map(bucketFromRecord)
            .filter(bucket => bucket.remainingAmount > 0 && bucket.validFrom <= input.now && (!bucket.validUntil || bucket.validUntil > input.now))
            .sort((left, right) => left.priority - right.priority || (left.validUntil || "9999").localeCompare(right.validUntil || "9999") || left.createdAt.localeCompare(right.createdAt));
          const currentBalance = buckets.reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
          if (input.amount === 0) return { ledgerEntries: [] };

          if (input.amount > 0) {
            const bucket = {
              id: `bucket-${randomUUID()}`,
              userId: input.userId,
              sourceType: "adjustment" as const,
              creditType: "promotional" as const,
              originalAmount: input.amount,
              remainingAmount: input.amount,
              validFrom: input.now,
              validUntil: null,
              priority: 20,
              createdAt: input.now,
              updatedAt: input.now
            };
            await tx.creditBucket.create({ data: bucket });
            const ledgerEntry = {
              id: `ledger-${randomUUID()}`,
              userId: input.userId,
              bucketId: bucket.id,
              entryType: "adjustment" as const,
              amount: input.amount,
              balanceAfter: currentBalance + input.amount,
              sourceRefType: "manual_adjustment",
              sourceRefId: input.sourceRefId,
              label: input.label,
              createdAt: input.now
            };
            await tx.creditLedgerEntry.create({ data: ledgerEntry });
            return { bucket: bucketFromRecord(bucket), ledgerEntries: [ledgerEntry] };
          }

          const debitAmount = Math.abs(input.amount);
          if (currentBalance < debitAmount) throw new Error("INSUFFICIENT_CREDITS");
          const ledgerEntries: CreditLedgerEntryRecord[] = [];
          let remaining = debitAmount;
          let balanceAfter = currentBalance;
          for (const bucket of buckets) {
            if (remaining <= 0) break;
            const deduction = Math.min(bucket.remainingAmount, remaining);
            if (tx.$executeRawUnsafe) {
              await tx.$executeRawUnsafe(
                "UPDATE credit_buckets SET remaining_amount = remaining_amount - ?, updated_at = ? WHERE id = ?",
                deduction,
                nowDate,
                bucket.id
              );
            } else {
              await tx.creditBucket.update?.({ where: { id: bucket.id }, data: { remainingAmount: bucket.remainingAmount - deduction, updatedAt: input.now } });
            }
            remaining -= deduction;
            balanceAfter -= deduction;
            const ledgerEntry = {
              id: `ledger-${randomUUID()}`,
              userId: input.userId,
              bucketId: bucket.id,
              entryType: "adjustment" as const,
              amount: -deduction,
              balanceAfter,
              sourceRefType: "manual_adjustment",
              sourceRefId: input.sourceRefId,
              label: input.label,
              createdAt: input.now
            };
            await tx.creditLedgerEntry.create({ data: ledgerEntry });
            ledgerEntries.push(ledgerEntry);
          }
          return { ledgerEntries };
        });
      },
      async createHold(hold) {
        const prisma = await getPrismaClient();
        await prisma.creditHold.create({ data: hold });
        return hold;
      },
      async updateHold(holdId, patch) {
        const prisma = await getPrismaClient();
        const record = await prisma.creditHold.update?.({ where: { id: holdId }, data: patch });
        return record ? { ...(patch as typeof patch), id: asString(record.id), userId: asString(record.userId), amount: asNumber(record.amount), status: asString(record.status, "active") as "active", expiresAt: toIso(record.expiresAt), createdAt: toIso(record.createdAt), updatedAt: toIso(record.updatedAt) } : undefined;
      },
      async getHold(holdId) {
        const prisma = await getPrismaClient();
        const record = await prisma.creditHold.findUnique?.({ where: { id: holdId } });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          amount: asNumber(record.amount),
          status: asString(record.status, "active") as "active" | "spent" | "released" | "refunded" | "expired",
          taskId: asString(record.taskId) || undefined,
          downloadId: asString(record.downloadId) || undefined,
          expiresAt: toIso(record.expiresAt),
          convertedAt: record.convertedAt ? toIso(record.convertedAt) : undefined,
          refundedAt: record.refundedAt ? toIso(record.refundedAt) : undefined,
          releasedAt: record.releasedAt ? toIso(record.releasedAt) : undefined,
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        } : undefined;
      }
    },
    billing: {
      async createOrder(input) {
        const prisma = await getPrismaClient();
        const plan = billingPlans[input.planId];
        const record = await prisma.order.create({
          data: {
            userId: input.userId,
            planId: input.planId,
            amountCents: plan.amountCents,
            currency: "CNY",
            provider: "epay",
            outTradeNo: `FA${Date.now()}${Math.floor(Math.random() * 1000)}`,
            status: "pending_payment",
            fulfillmentStatus: "pending"
          }
        });
        return orderToBillingOrder(record, input.creditsAfterPayment, input.memberStatusAfterPayment);
      },
      async createOrderRecord(order) {
        const prisma = await getPrismaClient();
        await prisma.order.create({ data: order });
        return order;
      },
      async getOrderByOutTradeNo(outTradeNo) {
        const prisma = await getPrismaClient();
        const record = await prisma.order.findUnique?.({ where: { outTradeNo } });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          planId: asString(record.planId, "credits-1500") as BillingOrder["planId"],
          amountCents: asNumber(record.amountCents),
          currency: "CNY",
          provider: "epay",
          outTradeNo: asString(record.outTradeNo),
          status: asString(record.status, "pending_payment") as "pending_payment" | "paid" | "failed" | "refunded",
          fulfillmentStatus: asString(record.fulfillmentStatus, "pending") as "pending" | "fulfilled" | "failed" | "retryable",
          paymentUrl: asString(record.paymentUrl) || undefined,
          paidAt: record.paidAt ? toIso(record.paidAt) : undefined,
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        } : undefined;
      },
      async updateOrder(orderId, patch) {
        const prisma = await getPrismaClient();
        const record = await prisma.order.update?.({ where: { id: orderId }, data: patch });
        return record ? {
          id: asString(record.id),
          userId: asString(record.userId),
          planId: asString(record.planId, "credits-1500") as BillingOrder["planId"],
          amountCents: asNumber(record.amountCents),
          currency: "CNY",
          provider: "epay",
          outTradeNo: asString(record.outTradeNo),
          status: asString(record.status, "pending_payment") as "pending_payment" | "paid" | "failed" | "refunded",
          fulfillmentStatus: asString(record.fulfillmentStatus, "pending") as "pending" | "fulfilled" | "failed" | "retryable",
          paymentUrl: asString(record.paymentUrl) || undefined,
          paidAt: record.paidAt ? toIso(record.paidAt) : undefined,
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        } : undefined;
      },
      async listOrders(userId) {
        const prisma = await getPrismaClient();
        const records = await prisma.order.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
        return records.map(record => ({
          id: asString(record.id),
          userId: asString(record.userId),
          planId: asString(record.planId, "credits-1500") as BillingOrder["planId"],
          amountCents: asNumber(record.amountCents),
          currency: "CNY",
          provider: "epay",
          outTradeNo: asString(record.outTradeNo),
          status: asString(record.status, "pending_payment") as "pending_payment" | "paid" | "failed" | "refunded",
          fulfillmentStatus: asString(record.fulfillmentStatus, "pending") as "pending" | "fulfilled" | "failed" | "retryable",
          paymentUrl: asString(record.paymentUrl) || undefined,
          paidAt: record.paidAt ? toIso(record.paidAt) : undefined,
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        }));
      },
      async createPaymentNotification(notification) {
        const prisma = await getPrismaClient();
        await prisma.paymentNotification.create({ data: notification });
        return notification;
      },
      async getPaymentNotificationByDigest(orderId, rawPayloadDigest) {
        const prisma = await getPrismaClient();
        const record = await prisma.paymentNotification.findUnique?.({ where: { orderId_rawPayloadDigest: { orderId, rawPayloadDigest } } });
        return record ? {
          id: asString(record.id),
          orderId: asString(record.orderId),
          providerTradeNo: asString(record.providerTradeNo) || undefined,
          verified: record.verified === true,
          rawPayloadDigest: asString(record.rawPayloadDigest),
          failureReason: asString(record.failureReason) || undefined,
          receivedAt: toIso(record.receivedAt),
          processedAt: record.processedAt ? toIso(record.processedAt) : undefined
        } : undefined;
      },
      async fulfillCreditPackOrder(input) {
        const prisma = await getPrismaClient();
        return runTransaction(prisma, async tx => {
          const existingNotification = await tx.paymentNotification.findFirst?.({
            where: { orderId: input.order.id }
          });
          const orderRecord = await tx.order.findUnique?.({ where: { id: input.order.id } });
          if (!orderRecord) throw new Error("ORDER_NOT_FOUND");
          const orderStatus = asString(orderRecord.fulfillmentStatus, "pending");
          if (existingNotification || orderStatus === "fulfilled") {
            await tx.user.update?.({
              where: { id: asString(orderRecord.userId) },
              data: { memberStatus: "credit_pack" }
            });
            return {
              order: {
                id: asString(orderRecord.id),
                userId: asString(orderRecord.userId),
                planId: asString(orderRecord.planId, "credits-1500") as BillingOrder["planId"],
                amountCents: asNumber(orderRecord.amountCents),
                currency: "CNY" as const,
                provider: "epay" as const,
                outTradeNo: asString(orderRecord.outTradeNo),
                status: asString(orderRecord.status, "pending_payment") as "pending_payment" | "paid" | "failed" | "refunded",
                fulfillmentStatus: asString(orderRecord.fulfillmentStatus, "pending") as "pending" | "fulfilled" | "failed" | "retryable",
                paymentUrl: asString(orderRecord.paymentUrl) || undefined,
                paidAt: orderRecord.paidAt ? toIso(orderRecord.paidAt) : undefined,
                createdAt: toIso(orderRecord.createdAt),
                updatedAt: toIso(orderRecord.updatedAt)
              },
              notification: existingNotification ? {
                id: asString(existingNotification.id),
                orderId: asString(existingNotification.orderId),
                providerTradeNo: asString(existingNotification.providerTradeNo) || undefined,
                verified: existingNotification.verified === true,
                rawPayloadDigest: asString(existingNotification.rawPayloadDigest),
                failureReason: asString(existingNotification.failureReason) || undefined,
                receivedAt: toIso(existingNotification.receivedAt),
                processedAt: existingNotification.processedAt ? toIso(existingNotification.processedAt) : undefined
              } : input.notification,
              duplicated: true
            };
          }

          const claimResult = await tx.order.updateMany?.({
            where: { id: input.order.id, fulfillmentStatus: { not: "fulfilled" } },
            data: {
              status: "paid",
              fulfillmentStatus: "fulfilled",
              paidAt: input.paidAt,
              updatedAt: input.paidAt
            }
          });
          if (claimResult && claimResult.count === 0) {
            const claimedOrder = await tx.order.findUnique?.({ where: { id: input.order.id } });
            await tx.user.update?.({
              where: { id: asString(claimedOrder?.userId || input.order.userId) },
              data: { memberStatus: "credit_pack" }
            });
            return {
              order: {
                id: asString(claimedOrder?.id || input.order.id),
                userId: asString(claimedOrder?.userId || input.order.userId),
                planId: asString(claimedOrder?.planId || input.order.planId, "credits-1500") as BillingOrder["planId"],
                amountCents: asNumber(claimedOrder?.amountCents || input.order.amountCents),
                currency: "CNY" as const,
                provider: "epay" as const,
                outTradeNo: asString(claimedOrder?.outTradeNo || input.order.outTradeNo),
                status: asString(claimedOrder?.status || input.order.status, "paid") as "pending_payment" | "paid" | "failed" | "refunded",
                fulfillmentStatus: asString(claimedOrder?.fulfillmentStatus || input.order.fulfillmentStatus, "fulfilled") as "pending" | "fulfilled" | "failed" | "retryable",
                paymentUrl: asString(claimedOrder?.paymentUrl || input.order.paymentUrl) || undefined,
                paidAt: claimedOrder?.paidAt ? toIso(claimedOrder.paidAt) : input.order.paidAt,
                createdAt: claimedOrder?.createdAt ? toIso(claimedOrder.createdAt) : input.order.createdAt,
                updatedAt: claimedOrder?.updatedAt ? toIso(claimedOrder.updatedAt) : input.order.updatedAt
              },
              notification: input.notification,
              duplicated: true
            };
          }

          await tx.paymentNotification.create({ data: input.notification });
          await tx.creditBucket.create({ data: input.bucket });
          await tx.creditLedgerEntry.create({ data: input.ledgerEntry });
          await tx.user.update?.({
            where: { id: input.order.userId },
            data: { memberStatus: "credit_pack" }
          });
          const updatedOrder = claimResult ? await tx.order.findUnique?.({ where: { id: input.order.id } }) : await tx.order.update?.({
            where: { id: input.order.id },
            data: {
              status: "paid",
              fulfillmentStatus: "fulfilled",
              paidAt: input.paidAt,
              updatedAt: input.paidAt
            }
          });

          const order = updatedOrder || { ...input.order, status: "paid", fulfillmentStatus: "fulfilled", paidAt: input.paidAt, updatedAt: input.paidAt };
          return {
            order: {
              id: asString(order.id),
              userId: asString(order.userId),
              planId: asString(order.planId, "credits-1500") as BillingOrder["planId"],
              amountCents: asNumber(order.amountCents),
              currency: "CNY" as const,
              provider: "epay" as const,
              outTradeNo: asString(order.outTradeNo),
              status: asString(order.status, "paid") as "pending_payment" | "paid" | "failed" | "refunded",
              fulfillmentStatus: asString(order.fulfillmentStatus, "fulfilled") as "pending" | "fulfilled" | "failed" | "retryable",
              paymentUrl: asString(order.paymentUrl) || undefined,
              paidAt: order.paidAt ? toIso(order.paidAt) : undefined,
              createdAt: toIso(order.createdAt),
              updatedAt: toIso(order.updatedAt)
            },
            notification: input.notification,
            bucket: input.bucket,
            ledgerEntry: input.ledgerEntry,
            duplicated: false
          };
        });
      },
      async createDownloadEvent(event) {
        const prisma = await getPrismaClient();
        await prisma.downloadEvent.create({ data: event });
        return event;
      },
      async listDownloadEvents(userId) {
        const prisma = await getPrismaClient();
        const records = await prisma.downloadEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
        return records.map(record => ({
          id: asString(record.id),
          assetId: asString(record.assetId),
          userId: asString(record.userId),
          downloadType: asString(record.downloadType, "standard_watermarked") as "standard_watermarked" | "hd_no_watermark",
          creditCost: asNumber(record.creditCost),
          createdAt: toIso(record.createdAt)
        }));
      }
    },
    modelConfig: {
      async listConfigurations() {
        const prisma = await getPrismaClient();
        const records = await listActiveModelConfigurationRecords(prisma);
        return records.map(activeModelConfigFromRecord);
      },
      async saveConfigurations(input) {
        const prisma = await getPrismaClient();
        await maybeEnsureModelConfigTables(prisma);
        return runTransaction(prisma, async tx => {
          const existing = await listActiveModelConfigurationRecords(tx);
          const beforeConfig = existing.length ? existing.map(editableModelConfigFromRecord) : undefined;
          const now = new Date();
          const existingCreatedAt = new Map(existing.map(record => [asString(record.id), record.createdAt || now]));
          const records = await saveSelectableModelConfigurationRecords(tx, input.models.map(model => ({
            id: model.id,
            displayName: model.displayName,
            provider: model.provider,
            modelName: model.model,
            baseUrl: model.baseUrl,
            apiKeySecretRef: model.apiKeySecretRef,
            executionMode: model.executionMode,
            requestTimeoutMs: model.requestTimeoutMs,
            enabled: model.enabled,
            isDefault: model.isDefault,
            lastTestStatus: input.testStatus || "untested",
            lastTestError: input.testError || null,
            lastTestedAt: null,
            updatedByUserId: input.changedByUserId,
            createdAt: existingCreatedAt.get(model.id) || now,
            updatedAt: now
          })));
          const configurations = records.map(activeModelConfigFromRecord);
          const defaultConfig = configurations.find(model => model.enabled && model.isDefault) || configurations[0];
          const changeRecord = await createModelConfigurationChangeRecord(tx, {
            id: `model-change-${randomUUID()}`,
            activeConfigurationId: defaultConfig?.id || input.models[0]?.id || "active",
            changedByUserId: input.changedByUserId,
            changeType: input.changeType,
            beforeConfigJson: beforeConfig,
            afterConfigJson: input.models,
            testStatus: input.testStatus || "untested",
            testError: input.testError || null,
            restoredFromChangeId: input.restoredFromChangeId || null,
            createdAt: now
          });
          return { configurations, change: modelConfigurationChangeFromRecord(changeRecord) };
        });
      },
      async getActiveConfiguration() {
        const prisma = await getPrismaClient();
        const record = await findActiveModelConfigurationRecord(prisma);
        return record ? activeModelConfigFromRecord(record) : undefined;
      },
      async saveActiveConfiguration(input) {
        const result = await this.saveConfigurations({
          models: [{
            id: "active",
            displayName: "Default Image Model",
            ...input.config,
            enabled: true,
            isDefault: true
          }],
          changedByUserId: input.changedByUserId,
          changeType: input.changeType,
          restoredFromChangeId: input.restoredFromChangeId,
          testStatus: input.testStatus,
          testError: input.testError
        });
        const configuration = result.configurations.find(model => model.enabled && model.isDefault) || result.configurations[0];
        return { configuration, change: result.change };
      },
      async updateActiveConfigurationTestResult(input) {
        const prisma = await getPrismaClient();
        const record = await updateActiveModelConfigurationTestResultRecord(prisma, input);
        return record ? activeModelConfigFromRecord(record) : undefined;
      },
      async listConfigurationChanges(limit = 10) {
        const prisma = await getPrismaClient();
        const records = await listModelConfigurationChangeRecords(prisma, limit);
        return records.map(modelConfigurationChangeFromRecord);
      },
      async getConfigurationChange(changeId) {
        const prisma = await getPrismaClient();
        const record = await findModelConfigurationChangeRecord(prisma, changeId);
        return record ? modelConfigurationChangeFromRecord(record) : undefined;
      }
    }
  };
}
