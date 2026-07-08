import { randomUUID } from "node:crypto";
import Module from "node:module";
import path from "node:path";
import sharp from "sharp";
import type { BillingPlanId } from "../src/types/billing";
import type { ImageAsset } from "../src/types/image";

const originalResolveFilename = (Module as unknown as { _resolveFilename: (...args: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: (...args: unknown[]) => string })._resolveFilename = function resolveAlias(request: unknown, parent: unknown, isMain: unknown, options: unknown) {
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(process.cwd(), ".tmp/smoke-repositories/src", request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

type RecordValue = string | number | boolean | null | Date | Record<string, unknown> | undefined;
type DbRecord = Record<string, RecordValue>;

function id(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function addOneCalendarMonth(date: Date) {
  const targetYear = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + 1;
  const targetLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCFullYear(targetYear, targetMonth, Math.min(date.getUTCDate(), targetLastDay));
  return result;
}

function comparable(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value || "");
}

function matchesWhere(record: DbRecord, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (value && typeof value === "object" && "gt" in value) {
      if (!(comparable(record[key]) > comparable((value as { gt: unknown }).gt))) return false;
      continue;
    }
    if (value && typeof value === "object" && "lte" in value) {
      if (!(comparable(record[key]) <= comparable((value as { lte: unknown }).lte))) return false;
      continue;
    }
    if (value && typeof value === "object" && "lt" in value) {
      if (!(Number(record[key] || 0) < Number((value as { lt: unknown }).lt))) return false;
      continue;
    }
    if (value && typeof value === "object" && "not" in value) {
      if (record[key] === (value as { not: unknown }).not) return false;
      continue;
    }
    if (value && typeof value === "object" && "notIn" in value) {
      const items = Array.isArray((value as { notIn: unknown }).notIn) ? (value as { notIn: unknown[] }).notIn : [];
      if (items.includes(record[key])) return false;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!matchesWhere(record, value as Record<string, unknown>)) return false;
      continue;
    }
    if (value === null) {
      if (record[key] !== null && record[key] !== undefined) return false;
      continue;
    }
    if (record[key] !== value) return false;
  }
  return true;
}

function makeDelegate(initial: DbRecord[] = [], constraints: { maxStringLengths?: Record<string, number> } = {}) {
  const rows = [...initial];
  const maxStringLengths = constraints.maxStringLengths || {};

  function assertConstraints(data: DbRecord) {
    for (const [key, value] of Object.entries(data)) {
      const maxLength = maxStringLengths[key];
      if (typeof value === "string" && maxLength !== undefined && value.length > maxLength) {
        throw new Error(`value too long for ${key}: ${value.length} > ${maxLength}`);
      }
    }
  }

  return {
    rows,
    async findMany(args: Record<string, unknown> = {}) {
      const where = args.where as Record<string, unknown> | undefined;
      const result = rows.filter(row => matchesWhere(row, where));
      return typeof args.take === "number" ? result.slice(0, args.take) : result;
    },
    async findUnique(args: Record<string, unknown>) {
      return rows.find(row => matchesWhere(row, args.where as Record<string, unknown>)) || null;
    },
    async findFirst(args: Record<string, unknown> = {}) {
      return rows.find(row => matchesWhere(row, args.where as Record<string, unknown> | undefined)) || null;
    },
    async create(args: Record<string, unknown>) {
      const data = args.data as DbRecord;
      assertConstraints(data);
      const row = { ...data, id: data.id || id("db"), createdAt: data.createdAt || new Date(), updatedAt: data.updatedAt || new Date() };
      rows.unshift(row);
      return row;
    },
    async update(args: Record<string, unknown>) {
      const row = rows.find(item => matchesWhere(item, args.where as Record<string, unknown>));
      if (!row) throw new Error(`record not found for ${JSON.stringify(args.where)}`);
      assertConstraints(args.data as DbRecord);
      for (const [key, value] of Object.entries(args.data as DbRecord)) {
        if (value && typeof value === "object" && "increment" in value) {
          row[key] = Number(row[key] || 0) + Number((value as { increment: number }).increment);
        } else {
          row[key] = value;
        }
      }
      row.updatedAt = new Date();
      return row;
    },
    async updateMany(args: Record<string, unknown>) {
      const matchingRows = rows.filter(item => matchesWhere(item, args.where as Record<string, unknown>));
      for (const row of matchingRows) {
        for (const [key, value] of Object.entries(args.data as DbRecord)) {
          if (value && typeof value === "object" && "increment" in value) {
            row[key] = Number(row[key] || 0) + Number((value as { increment: number }).increment);
          } else {
            row[key] = value;
          }
        }
        row.updatedAt = new Date();
      }
      return { count: matchingRows.length };
    },
    async count(args: Record<string, unknown> = {}) {
      return rows.filter(row => matchesWhere(row, args.where as Record<string, unknown> | undefined)).length;
    }
  };
}

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function run() {
  const { createPrismaRepositories, setPrismaClientForTesting } = await import("../src/server/data/prisma-adapter");
  const { createMockDataStore, createMockRepositories, setRepositoriesForTesting } = await import("../src/server/data/repositories");
  const { getCreditsSummary } = await import("../src/server/account/account-service");
  const { createTask, deleteAsset, listAssets, runImageTask, transitionTaskState } = await import("../src/server/image/business/image-service");
  const { storeGeneratedAsset } = await import("../src/server/image/storage/upload-service");
  const { submitImageGeneration } = await import("../src/server/image/ai/image-model-adapter");
  const { modelConfigurationPresets, restoreModelConfiguration, saveActiveModelConfiguration, validateModelConfiguration } = await import("../src/server/image/admin/model-config-service");
  const { TaskCapabilityError, TaskConcurrencyError } = await import("../src/server/image/business/task-policy");
  const { creditValidUntilIso } = await import("../src/server/credits/credit-validity");

  expect(
    creditValidUntilIso(new Date("2026-01-31T12:34:56.000Z")) === "2026-02-28T12:34:56.000Z",
    "credit validity should add one calendar month and clamp end-of-month dates"
  );
  expect(modelConfigurationPresets.find(preset => preset.id === "openai-compatible")?.config.apiKeySecretRef === "OPENAI_API_KEY", "OpenAI model preset should use OPENAI_API_KEY as its default secret ref");
  const encryptedPastedKeyConfig = validateModelConfiguration({
    provider: "agnes",
    model: "agnes-image-2.1-flash",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    apiKeySecretRef: "sk-test-secret-value-that-should-not-be-returned",
    executionMode: "live",
    requestTimeoutMs: 1000
  });
  expect(encryptedPastedKeyConfig.apiKeySecretRef.startsWith("enc:v1:"), "pasted model API keys should be stored as encrypted secret refs");
  expect(!encryptedPastedKeyConfig.apiKeySecretRef.includes("sk-test-secret-value"), "encrypted model API key refs should not expose pasted API key values");
  const previousFluxArtImageApiKeyForSecretRef = process.env.FLUXART_IMAGE_API_KEY;
  process.env.FLUXART_IMAGE_API_KEY = "sk-smoke-secret-ref-normalized";
  try {
    const normalizedSecretRefConfig = validateModelConfiguration({
      provider: "agnes",
      model: "agnes-image-2.1-flash",
      baseUrl: "https://apihub.agnes-ai.com/v1",
      apiKeySecretRef: "sk-smoke-secret-ref-normalized",
      executionMode: "live",
      requestTimeoutMs: 1000
    });
    expect(normalizedSecretRefConfig.apiKeySecretRef === "FLUXART_IMAGE_API_KEY", "live model config should normalize a pasted key that already exists in the server environment");
  } finally {
    if (previousFluxArtImageApiKeyForSecretRef) process.env.FLUXART_IMAGE_API_KEY = previousFluxArtImageApiKeyForSecretRef;
    else delete process.env.FLUXART_IMAGE_API_KEY;
  }
  const restoreStore = createMockDataStore();
  setRepositoriesForTesting(createMockRepositories(restoreStore));
  try {
    const savedConfig = await saveActiveModelConfiguration({
      models: [{
        id: "default-image-model",
        displayName: "Default Image Model",
        provider: "agnes",
        model: "agnes-image-2.1-flash",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        apiKeySecretRef: "sk-admin-configured-secret-value",
        executionMode: "mock",
        requestTimeoutMs: 120000,
        enabled: true,
        isDefault: true
      }]
    }, "usr-smoke");
    expect(savedConfig.changes.length === 1, "model config save should create one audit change");
    expect(restoreStore.activeImageModelConfigurations[0].apiKeySecretRef.startsWith("enc:v1:"), "admin-entered model API keys should be persisted as encrypted refs");
    expect(savedConfig.configurations[0]?.apiKeySecretRef === "__FLUXART_CONFIGURED_MODEL_API_KEY__", "model admin responses should not echo stored API keys");
    const restoredConfig = await restoreModelConfiguration(savedConfig.changes[0].id, "usr-smoke");
    expect(restoredConfig.changes.length === 1, "restoring an identical active model configuration should not append duplicate audit changes");
  } finally {
    setRepositoriesForTesting(undefined);
  }
  const userId = "usr-smoke";
  const now = new Date("2026-06-24T00:00:00.000Z");
  const delegates = {
    user: makeDelegate([{ id: userId, username: "smoke", displayName: "Smoke User", status: "active", memberStatus: "free", createdAt: now, updatedAt: now }]),
    userCredential: makeDelegate([]),
    userSession: makeDelegate([]),
    authRateLimitBucket: makeDelegate([]),
    creditBucket: makeDelegate([{ id: "bucket-smoke", userId, sourceType: "registration", creditType: "promotional", originalAmount: 50, remainingAmount: 50, validFrom: now, validUntil: null, priority: 10, createdAt: now, updatedAt: now }]),
    creditLedgerEntry: makeDelegate([]),
    creditHold: makeDelegate([]),
    order: makeDelegate([]),
    paymentNotification: makeDelegate([]),
    imageUpload: makeDelegate([]),
    imageTask: makeDelegate([], { maxStringLengths: { failureReason: 255 } }),
    providerSubmission: makeDelegate([]),
    providerResult: makeDelegate([]),
    imageAsset: makeDelegate([]),
    assetVersionNode: makeDelegate([]),
    downloadEvent: makeDelegate([]),
    assetCleanupJob: makeDelegate([]),
    activeImageModelConfiguration: makeDelegate([]),
    modelConfigurationChange: makeDelegate([])
  };
  const prismaClient = {
    ...delegates,
    async $transaction<T>(fn: (client: typeof delegates) => Promise<T>) {
      return fn(delegates);
    }
  };

  setPrismaClientForTesting(prismaClient);
  const repositories = createPrismaRepositories();

  const account = await repositories.account.getCurrentAccount(userId);
  expect(account.credits === 50, "Prisma adapter should read account credit balance");

  const savedModelConfig = await repositories.modelConfig.saveActiveConfiguration({
    config: {
      provider: "custom",
      model: "runtime-model",
      baseUrl: "https://provider.example.test/v1",
      apiKeySecretRef: "RUNTIME_PROVIDER_KEY",
      executionMode: "live",
      requestTimeoutMs: 660000
    },
    changedByUserId: userId,
    changeType: "save"
  });
  expect(savedModelConfig.configuration.model === "runtime-model", "Prisma adapter should save the active image model configuration");
  expect(savedModelConfig.change.afterConfig[0]?.model === "runtime-model", "Prisma adapter should audit model configuration saves");
  expect((await repositories.modelConfig.listConfigurationChanges(5)).length === 1, "Prisma adapter should list model configuration changes");
  const activeModelConfig = await repositories.modelConfig.getActiveConfiguration();
  expect(activeModelConfig?.requestTimeoutMs === 660000, "Prisma adapter should read the active image model configuration");
  await repositories.modelConfig.saveConfigurations({
    models: [
      {
        id: "delete-candidate-model",
        displayName: "Delete Candidate Model",
        provider: "custom",
        model: "delete-candidate-runtime-model",
        baseUrl: "https://provider.example.test/v1",
        apiKeySecretRef: "DELETE_CANDIDATE_PROVIDER_KEY",
        executionMode: "mock",
        requestTimeoutMs: 120000,
        enabled: true,
        isDefault: true
      },
      {
        id: "remaining-model",
        displayName: "Remaining Model",
        provider: "custom",
        model: "remaining-runtime-model",
        baseUrl: "https://provider.example.test/v1",
        apiKeySecretRef: "REMAINING_PROVIDER_KEY",
        executionMode: "mock",
        requestTimeoutMs: 120000,
        enabled: true,
        isDefault: false
      }
    ],
    changedByUserId: userId,
    changeType: "save"
  });
  await repositories.modelConfig.saveConfigurations({
    models: [{
      id: "remaining-model",
      displayName: "Remaining Model",
      provider: "custom",
      model: "remaining-runtime-model",
      baseUrl: "https://provider.example.test/v1",
      apiKeySecretRef: "REMAINING_PROVIDER_KEY",
      executionMode: "mock",
      requestTimeoutMs: 120000,
      enabled: true,
      isDefault: true
    }],
    changedByUserId: userId,
    changeType: "save"
  });
  const remainingModelConfigs = await repositories.modelConfig.listConfigurations();
  expect(remainingModelConfigs.length === 1 && remainingModelConfigs[0].id === "remaining-model", "Prisma adapter should hide deleted selectable model configurations");
  expect(!!delegates.activeImageModelConfiguration.rows.find(row => row.id === "delete-candidate-model")?.deletedAt, "Prisma adapter should soft-delete removed selectable model configurations");

  const rawActiveModelRows: DbRecord[] = [];
  const rawModelChangeRows: DbRecord[] = [];
  let rawActiveModelTableExists = false;
  let rawModelChangeTableExists = false;
  const rawActiveModelColumns = new Set(["id", "provider", "model_name", "base_url", "api_key_secret_ref", "execution_mode", "request_timeout_ms", "last_test_status", "last_tested_at", "last_test_error", "updated_by_user_id", "created_at", "updated_at"]);
  type TestingPrismaClient = Parameters<typeof setPrismaClientForTesting>[0];
  function throwMissingRawTable(tableName: string): never {
    const error = new Error(`Table 'flux_art.${tableName}' doesn't exist`);
    (error as Error & { code?: string }).code = "1146";
    throw error;
  }
  function assertMysqlIdentifierLengths(query: string) {
    for (const match of query.matchAll(/`([^`]+)`/g)) {
      const identifier = match[1];
      if (identifier.length > 64) {
        const error = new Error(`Identifier name '${identifier}' is too long`);
        (error as Error & { code?: string }).code = "1059";
        throw error;
      }
    }
  }
  function assertMysqlDateTimeValue(value: unknown, columnName: string) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const error = new Error(`Incorrect datetime value: '${value}' for column '${columnName}' at row 1`);
      (error as Error & { code?: string }).code = "1292";
      throw error;
    }
  }
  const rawModelConfigClient = {
    ...delegates,
    activeImageModelConfiguration: undefined,
    modelConfigurationChange: undefined,
    async $transaction<T>(fn: (client: NonNullable<TestingPrismaClient>) => Promise<T>) {
      return fn(rawModelConfigClient as NonNullable<TestingPrismaClient>);
    },
    async $executeRawUnsafe(query: string, ...values: unknown[]) {
      if (query.includes("CREATE TABLE IF NOT EXISTS `active_image_model_configurations`")) {
        assertMysqlIdentifierLengths(query);
        const alreadyExists = rawActiveModelTableExists;
        rawActiveModelTableExists = true;
        if (!alreadyExists) {
          rawActiveModelColumns.add("display_name");
          rawActiveModelColumns.add("enabled");
          rawActiveModelColumns.add("is_default");
          rawActiveModelColumns.add("deleted_at");
        }
        return 0;
      }

      if (query.includes("ALTER TABLE active_image_model_configurations ADD COLUMN")) {
        if (!rawActiveModelTableExists) throwMissingRawTable("active_image_model_configurations");
        const column = query.match(/ADD COLUMN `([^`]+)`/)?.[1];
        if (column) rawActiveModelColumns.add(column);
        return 0;
      }

      if (query.includes("ALTER TABLE active_image_model_configurations MODIFY COLUMN `api_key_secret_ref`")) {
        if (!rawActiveModelTableExists) throwMissingRawTable("active_image_model_configurations");
        return 0;
      }

      if (query.includes("CREATE TABLE IF NOT EXISTS `model_configuration_changes`")) {
        assertMysqlIdentifierLengths(query);
        rawModelChangeTableExists = true;
        return 0;
      }

      if (query.includes("INSERT INTO active_image_model_configurations")) {
        if (!rawActiveModelTableExists) throwMissingRawTable("active_image_model_configurations");
        assertMysqlDateTimeValue(values[11], "last_tested_at");
        assertMysqlDateTimeValue(values[14], "created_at");
        assertMysqlDateTimeValue(values[15], "updated_at");
        const row: DbRecord = {
          id: String(values[0]),
          displayName: String(values[1]),
          provider: String(values[2]),
          modelName: String(values[3]),
          baseUrl: String(values[4]),
          apiKeySecretRef: String(values[5]),
          executionMode: String(values[6]),
          requestTimeoutMs: Number(values[7]),
          enabled: Boolean(values[8]),
          isDefault: Boolean(values[9]),
          lastTestStatus: String(values[10]),
          lastTestedAt: values[11] as RecordValue,
          lastTestError: values[12] as RecordValue,
          updatedByUserId: values[13] as RecordValue,
          createdAt: values[14] as RecordValue,
          updatedAt: values[15] as RecordValue
        };
        const existingIndex = rawActiveModelRows.findIndex(item => item.id === row.id);
        if (existingIndex >= 0) rawActiveModelRows[existingIndex] = { ...rawActiveModelRows[existingIndex], ...row };
        else rawActiveModelRows.unshift(row);
        return 1;
      }

      if (query.includes("UPDATE active_image_model_configurations")) {
        if (!rawActiveModelTableExists) throwMissingRawTable("active_image_model_configurations");
        if (query.includes("SET enabled = false")) {
          for (const row of rawActiveModelRows) {
            if (!values.slice(1).includes(row.id)) {
              row.enabled = false;
              row.deletedAt = values[0] as RecordValue;
            }
          }
          return 1;
        }
        if (query.includes("SET display_name =")) {
          const row = rawActiveModelRows.find(item => item.id === "active");
          if (row) {
            row.displayName = row.displayName || "Default Image Model";
            row.enabled = true;
            row.isDefault = true;
          }
          return row ? 1 : 0;
        }
        const row = rawActiveModelRows.find(item => item.id === String(values[5]));
        if (!row) return 0;
        assertMysqlDateTimeValue(values[1], "last_tested_at");
        assertMysqlDateTimeValue(values[4], "updated_at");
        row.lastTestStatus = String(values[0]);
        row.lastTestedAt = values[1] as RecordValue;
        row.lastTestError = values[2] as RecordValue;
        row.updatedByUserId = values[3] as RecordValue;
        row.updatedAt = values[4] as RecordValue;
        return 1;
      }

      if (query.includes("INSERT INTO model_configuration_changes")) {
        if (!rawModelChangeTableExists) throwMissingRawTable("model_configuration_changes");
        rawModelChangeRows.unshift({
          id: String(values[0]),
          activeConfigurationId: String(values[1]),
          changedByUserId: String(values[2]),
          changeType: String(values[3]),
          beforeConfigJson: values[4] as RecordValue,
          afterConfigJson: values[5] as RecordValue,
          testStatus: String(values[6]),
          testError: values[7] as RecordValue,
          restoredFromChangeId: values[8] as RecordValue,
          createdAt: values[9] as RecordValue
        });
        return 1;
      }

      throw new Error(`unexpected raw execute query: ${query}`);
    },
    async $queryRawUnsafe(query: string, ...values: unknown[]) {
      if (query.includes("FROM INFORMATION_SCHEMA.COLUMNS")) {
        const tableName = String(values[0] || "");
        if (tableName !== "active_image_model_configurations" || !rawActiveModelTableExists) return [];
        return [...rawActiveModelColumns].map(columnName => ({
          columnName,
          dataType: columnName === "deleted_at" ? "datetime" : "varchar",
          characterMaximumLength: columnName === "api_key_secret_ref" ? 128 : 191
        }));
      }

      if (query.includes("FROM active_image_model_configurations")) {
        if (!rawActiveModelTableExists) throwMissingRawTable("active_image_model_configurations");
        if (query.includes("WHERE id = ?")) {
          const record = rawActiveModelRows.find(item => item.id === String(values[0] || "active"));
          return record ? [record] : [];
        }
        return query.includes("deleted_at IS NULL")
          ? rawActiveModelRows.filter(row => row.deletedAt === null || row.deletedAt === undefined)
          : rawActiveModelRows;
      }

      if (query.includes("FROM model_configuration_changes")) {
        if (!rawModelChangeTableExists) throwMissingRawTable("model_configuration_changes");
        if (query.includes("WHERE id = ?")) {
          const record = rawModelChangeRows.find(item => item.id === String(values[0]));
          return record ? [record] : [];
        }
        const limit = Number(query.match(/LIMIT\s+(\d+)/i)?.[1] || rawModelChangeRows.length);
        return rawModelChangeRows
          .filter(item => item.activeConfigurationId === String(values[0] || "active"))
          .sort((left, right) => comparable(right.createdAt).localeCompare(comparable(left.createdAt)))
          .slice(0, limit);
      }

      throw new Error(`unexpected raw query: ${query}`);
    }
  } as TestingPrismaClient;
  setPrismaClientForTesting(rawModelConfigClient);
  const rawFallbackRepositories = createPrismaRepositories();
  const rawFallbackConfig = await rawFallbackRepositories.modelConfig.saveActiveConfiguration({
    config: {
      provider: "raw",
      model: "raw-runtime-model",
      baseUrl: "https://provider.example.test/raw/v1",
      apiKeySecretRef: "provider.api-key",
      executionMode: "live",
      requestTimeoutMs: 450000
    },
    changedByUserId: userId,
    changeType: "save",
    testStatus: "passed"
  });
  expect(rawFallbackConfig.configuration.model === "raw-runtime-model", "Prisma adapter should raw-fallback save model configuration when generated delegates are stale");
  expect(rawActiveModelTableExists && rawModelChangeTableExists, "Prisma adapter should initialize missing model configuration tables before raw-fallback queries");
  expect(rawFallbackConfig.change.afterConfig[0]?.apiKeySecretRef === "provider.api-key", "Prisma adapter should parse raw JSON audit payloads");
  expect((await rawFallbackRepositories.modelConfig.getActiveConfiguration())?.provider === "raw", "Prisma adapter should raw-fallback read active model configuration");
  await rawFallbackRepositories.modelConfig.updateActiveConfigurationTestResult({
    testStatus: "failed",
    testedAt: now.toISOString(),
    testError: "raw fallback test failure",
    updatedByUserId: userId
  });
  expect((await rawFallbackRepositories.modelConfig.getActiveConfiguration())?.lastTestStatus === "failed", "Prisma adapter should raw-fallback update model test result");
  expect((await rawFallbackRepositories.modelConfig.listConfigurationChanges(5)).length === 1, "Prisma adapter should raw-fallback list model configuration changes");
  expect((await rawFallbackRepositories.modelConfig.getConfigurationChange(rawFallbackConfig.change.id))?.afterConfig[0]?.model === "raw-runtime-model", "Prisma adapter should raw-fallback read one model configuration change");
  setPrismaClientForTesting(prismaClient);

  const registration = await repositories.auth.createRegistration({
    user: { username: "registered", displayName: "Registered User", memberStatus: "free" },
    credential: {
      id: "credential-registered",
      passwordHash: "hash",
      hashVersion: "scrypt-v1",
      passwordChangedAt: now.toISOString()
    },
    creditBucket: {
      id: "bucket-registered",
      sourceType: "registration",
      creditType: "promotional",
      originalAmount: 50,
      remainingAmount: 50,
      validFrom: now.toISOString(),
      validUntil: new Date("2026-09-22T00:00:00.000Z").toISOString(),
      priority: 10,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    },
    ledgerEntry: {
      id: "ledger-registered",
      entryType: "grant",
      amount: 50,
      balanceAfter: 50,
      sourceRefType: "registration",
      label: "Registration Credit Grant",
      createdAt: now.toISOString()
    },
    session: {
      id: "session-registered",
      tokenHash: "registered-token-hash",
      slidingExpiresAt: new Date("2026-07-24T00:00:00.000Z").toISOString(),
      absoluteExpiresAt: new Date("2026-09-22T00:00:00.000Z").toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }
  });
  expect(registration.creditBucket.userId === registration.user.id, "Prisma adapter should atomically attach registration bucket to user");
  expect(registration.ledgerEntry.sourceRefId === registration.user.id, "Prisma adapter should attach registration ledger source to user");
  expect((await repositories.account.getCurrentAccount(registration.user.id)).credits === 50, "Prisma adapter should expose registration credit grant");

  const firstRateLimit = await repositories.auth.consumeRateLimit({
    scope: "login:username:smoke",
    now: now.toISOString(),
    resetAt: new Date("2026-06-24T00:05:00.000Z").toISOString(),
    maxAttempts: 2
  });
  const secondRateLimit = await repositories.auth.consumeRateLimit({
    scope: "login:username:smoke",
    now: now.toISOString(),
    resetAt: new Date("2026-06-24T00:05:00.000Z").toISOString(),
    maxAttempts: 2
  });
  const blockedRateLimit = await repositories.auth.consumeRateLimit({
    scope: "login:username:smoke",
    now: now.toISOString(),
    resetAt: new Date("2026-06-24T00:05:00.000Z").toISOString(),
    maxAttempts: 2
  });
  expect(firstRateLimit.allowed && secondRateLimit.allowed && !blockedRateLimit.allowed, "Prisma adapter should persist auth rate limits");

  const credential = await repositories.auth.createCredential({
    id: "credential-smoke",
    userId,
    username: "smoke",
    passwordHash: "hash",
    hashVersion: "scrypt-v1",
    passwordChangedAt: now.toISOString()
  });
  expect((await repositories.auth.getCredentialByUsername(credential.username))?.userId === userId, "Prisma adapter should create/read credentials by username");
  expect((await repositories.account.getCurrentAccount(userId)).username === credential.username, "Prisma adapter should round-trip account username from credentials");
  await repositories.auth.updatePasswordHash(userId, "hash2", now.toISOString());
  expect((await repositories.auth.getCredentialByUserId(userId))?.passwordHash === "hash2", "Prisma adapter should update credentials");

  const session = await repositories.auth.createSession({
    id: "session-smoke",
    userId,
    tokenHash: "token-hash",
    slidingExpiresAt: new Date("2026-07-24T00:00:00.000Z").toISOString(),
    absoluteExpiresAt: new Date("2026-09-22T00:00:00.000Z").toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
  expect((await repositories.auth.getSessionByTokenHash(session.tokenHash))?.id === session.id, "Prisma adapter should create/read sessions");
  await repositories.auth.touchSession(session.id, new Date("2026-07-25T00:00:00.000Z").toISOString());
  expect((await repositories.auth.listActiveSessions(userId, now.toISOString())).length === 1, "Prisma adapter should list active sessions");
  await repositories.auth.revokeSession(session.id, now.toISOString());
  expect((await repositories.auth.listActiveSessions(userId, now.toISOString())).length === 0, "Prisma adapter should update/revoke sessions");

  const bucket = await repositories.credits.createBucket({
    id: "bucket-purchased-smoke",
    userId,
    sourceType: "purchased",
    creditType: "purchased",
    originalAmount: 500,
    remainingAmount: 500,
    validFrom: now.toISOString(),
    validUntil: new Date("2028-06-24T00:00:00.000Z").toISOString(),
    priority: 90,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
  expect((await repositories.credits.listBuckets(userId)).some(item => item.id === bucket.id), "Prisma adapter should create/list credit buckets");
  await repositories.credits.updateBucket(bucket.id, { remainingAmount: 490 });
  expect((await repositories.credits.listBuckets(userId)).find(item => item.id === bucket.id)?.remainingAmount === 490, "Prisma adapter should update credit buckets");

  const ledger = await repositories.credits.createLedgerEntry({
    id: "ledger-smoke",
    userId,
    bucketId: bucket.id,
    entryType: "grant",
    amount: 500,
    balanceAfter: 550,
    sourceRefType: "smoke",
    label: "Repository smoke grant",
    createdAt: now.toISOString()
  });
  expect((await repositories.credits.listLedgerEntries(userId)).some(item => item.id === ledger.id), "Prisma adapter should create/list ledger entries");

  const reservation = await repositories.credits.reserveCredits({
    userId,
    amount: 20,
    holdId: "hold-reservation-smoke",
    taskId: "task-reservation-smoke",
    label: "Repository Reservation Hold",
    now: now.toISOString(),
    expiresAt: new Date("2026-06-24T01:00:00.000Z").toISOString()
  });
  expect(reservation.hold.amount === 20, "Prisma adapter should create a credit hold during reservation");
  expect(reservation.ledgerEntries.some(entry => entry.entryType === "hold" && entry.amount < 0), "Prisma adapter should write hold ledger entries during reservation");
  expect((await repositories.credits.listBuckets(userId)).find(item => item.id === "bucket-smoke")?.remainingAmount === 30, "Prisma adapter should deduct reserved credits from priority buckets");
  const spentReservation = await repositories.credits.finalizeHoldSpend({ holdId: reservation.hold.id, now: now.toISOString(), label: "Repository Reservation Spend" });
  expect(spentReservation?.hold.status === "spent", "Prisma adapter should convert active credit holds to spent");
  expect(spentReservation?.ledgerEntries.some(entry => entry.entryType === "spend" && entry.amount < 0), "Prisma adapter should write spend ledger entries");
  const refundedReservation = await repositories.credits.refundHold({ holdId: reservation.hold.id, now: now.toISOString(), label: "Repository Reservation Refund" });
  expect(refundedReservation?.hold.status === "refunded", "Prisma adapter should refund spent credit holds");
  expect(refundedReservation?.ledgerEntries.some(entry => entry.entryType === "refund" && entry.amount > 0), "Prisma adapter should write refund ledger entries");
  expect((await repositories.credits.listBuckets(userId)).find(item => item.id === "bucket-smoke")?.remainingAmount === 50, "Prisma adapter should restore bucket credits during refund");

  const positiveAdjustment = await repositories.credits.createAdjustment({ userId, amount: 7, now: now.toISOString(), label: "Repository Positive Adjustment", sourceRefId: "adjust-positive-smoke" });
  expect(positiveAdjustment.bucket?.sourceType === "adjustment", "Prisma adapter should create an adjustment bucket for positive adjustments");
  expect(positiveAdjustment.ledgerEntries.some(entry => entry.entryType === "adjustment" && entry.amount === 7), "Prisma adapter should write positive adjustment ledger entries");
  const negativeAdjustment = await repositories.credits.createAdjustment({ userId, amount: -5, now: now.toISOString(), label: "Repository Negative Adjustment", sourceRefId: "adjust-negative-smoke" });
  expect(negativeAdjustment.ledgerEntries.some(entry => entry.entryType === "adjustment" && entry.amount < 0), "Prisma adapter should write negative adjustment ledger entries");

  const hold = await repositories.credits.createHold({
    id: "hold-smoke",
    userId,
    amount: 10,
    status: "active",
    expiresAt: new Date("2026-06-24T01:00:00.000Z").toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
  expect((await repositories.credits.getHold(hold.id))?.status === "active", "Prisma adapter should create/read credit holds");
  await repositories.credits.updateHold(hold.id, { status: "released", releasedAt: now.toISOString() });
  expect((await repositories.credits.getHold(hold.id))?.status === "released", "Prisma adapter should update credit holds");

  const lowBalanceStore = createMockDataStore();
  lowBalanceStore.users[0].memberStatus = "free";
  lowBalanceStore.creditBuckets = [];
  lowBalanceStore.ledgerEntries = [];
  lowBalanceStore.tasks = [];
  lowBalanceStore.creditHolds = [];
  setRepositoriesForTesting(createMockRepositories(lowBalanceStore));
  const lowBalanceCredits = await getCreditsSummary(lowBalanceStore.users[0].id);
  expect(lowBalanceCredits.credits === 10, "credit service should lazily grant daily free credits on balance check");
  expect(lowBalanceCredits.recentChanges.some(entry => entry.label === "Daily Free Credit Grant"), "credit service should record a daily free grant ledger entry");
  const dailyGrantBucket = lowBalanceStore.creditBuckets.find(bucket => bucket.sourceType === "daily_free");
  expect(
    dailyGrantBucket?.validUntil && dailyGrantBucket.validUntil === addOneCalendarMonth(new Date(dailyGrantBucket.validFrom)).toISOString(),
    "daily free credits should use a one-month validity window"
  );
  const cappedDailyStore = createMockDataStore();
  const currentSmokeDate = new Date();
  cappedDailyStore.users[0].memberStatus = "free";
  cappedDailyStore.creditBuckets = [0, 1, 2].map(index => ({
    id: `bucket-daily-cap-${index}`,
    userId: cappedDailyStore.users[0].id,
    sourceType: "daily_free" as const,
    creditType: "promotional" as const,
    originalAmount: 10,
    remainingAmount: 10,
    validFrom: new Date(currentSmokeDate.getTime() - index * 86400000).toISOString(),
    validUntil: new Date(currentSmokeDate.getTime() + 2 * 86400000).toISOString(),
    priority: 5,
    createdAt: currentSmokeDate.toISOString(),
    updatedAt: currentSmokeDate.toISOString()
  }));
  cappedDailyStore.ledgerEntries = [];
  setRepositoriesForTesting(createMockRepositories(cappedDailyStore));
  const cappedDailyCredits = await getCreditsSummary(cappedDailyStore.users[0].id);
  expect(cappedDailyCredits.credits === 30, "daily free credits should cap at 30 active credits");
  expect(cappedDailyStore.creditBuckets.length === 3, "daily free cap should avoid creating an extra bucket");
  setRepositoriesForTesting(undefined);

  const configuredModelStore = createMockDataStore();
  configuredModelStore.activeImageModelConfigurations = [{
    id: "active",
    displayName: "Runtime Task Model",
    provider: "custom",
    model: "runtime-task-model",
    baseUrl: "https://provider.example.test/v1",
    apiKeySecretRef: "RUNTIME_PROVIDER_KEY",
    executionMode: "mock",
    requestTimeoutMs: 660000,
    enabled: true,
    isDefault: true,
    lastTestStatus: "untested",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }, {
    id: "premium-model",
    displayName: "Premium Model",
    provider: "custom",
    model: "premium-task-model",
    baseUrl: "https://provider.example.test/v1",
    apiKeySecretRef: "RUNTIME_PROVIDER_KEY",
    executionMode: "mock",
    requestTimeoutMs: 660000,
    enabled: true,
    isDefault: false,
    lastTestStatus: "untested",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }];
  configuredModelStore.creditBuckets[0].remainingAmount = 100;
  configuredModelStore.creditBuckets[0].originalAmount = 100;
  configuredModelStore.tasks = [];
  configuredModelStore.creditHolds = [];
  configuredModelStore.ledgerEntries = [];
  setRepositoriesForTesting(createMockRepositories(configuredModelStore));
  configuredModelStore.users[0].memberStatus = "free";
  const freeConfiguredTask = await createTask({ taskType: "t2i", prompt: "configured model", count: 1, size: "1024x1024", selectedImageModelId: "premium-model" }, configuredModelStore.users[0].id);
  expect(freeConfiguredTask.modelProvider === "custom" && freeConfiguredTask.modelName === "runtime-task-model", "free task creation should ignore selected models and snapshot the default image model");
  configuredModelStore.users[0].memberStatus = "credit_pack";
  configuredModelStore.creditBuckets[0].remainingAmount = 100;
  const paidConfiguredTask = await createTask({ taskType: "t2i", prompt: "paid configured model", count: 1, size: "1024x1024", selectedImageModelId: "premium-model" }, configuredModelStore.users[0].id);
  expect(paidConfiguredTask.modelProvider === "custom" && paidConfiguredTask.modelName === "premium-task-model", "credit pack task creation should snapshot the selected enabled image model");
  setRepositoriesForTesting(undefined);

  setRepositoriesForTesting(createMockRepositories(lowBalanceStore));
  try {
    await createTask({ taskType: "t2i", prompt: "too expensive", count: 4, size: "1024x1024" }, lowBalanceStore.users[0].id);
    throw new Error("expected insufficient credits");
  } catch (error) {
    expect(error instanceof Error && error.name === "CreditBalanceError", "credit service should reject insufficient generation balance");
  }
  expect(lowBalanceStore.tasks.length === 0, "insufficient credit failures should not create image tasks");
  expect(lowBalanceStore.creditHolds.length === 0, "insufficient credit failures should not create credit holds");
  setRepositoriesForTesting(undefined);

  const failureStore = createMockDataStore();
  failureStore.users[0].memberStatus = "free";
  failureStore.creditBuckets = [{
    id: "bucket-failure",
    userId: failureStore.users[0].id,
    sourceType: "registration",
    creditType: "promotional",
    originalAmount: 50,
    remainingAmount: 50,
    validFrom: now.toISOString(),
    validUntil: new Date("2026-09-22T00:00:00.000Z").toISOString(),
    priority: 10,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }];
  failureStore.ledgerEntries = [];
  failureStore.tasks = [];
  failureStore.creditHolds = [];
  setRepositoriesForTesting(createMockRepositories(failureStore));
  const previousImageModelExecution = process.env.IMAGE_MODEL_EXECUTION;
  const previousFluxArtImageApiKey = process.env.FLUXART_IMAGE_API_KEY;
  process.env.IMAGE_MODEL_EXECUTION = "live";
  delete process.env.FLUXART_IMAGE_API_KEY;
  try {
    const providerFailureTask = await createTask({ taskType: "t2i", prompt: "provider failure", count: 1, size: "1024x1024" }, failureStore.users[0].id);
    const failedProviderTask = await runImageTask(providerFailureTask.id, failureStore.users[0].id);
    expect(failedProviderTask?.status === "failed", "provider failure should fail the queued runner task");
    expect(failedProviderTask?.errorMessage?.includes("Missing FLUXART_IMAGE_API_KEY"), "provider failure should surface missing live key");
  } finally {
    if (previousImageModelExecution) process.env.IMAGE_MODEL_EXECUTION = previousImageModelExecution;
    else delete process.env.IMAGE_MODEL_EXECUTION;
    if (previousFluxArtImageApiKey) process.env.FLUXART_IMAGE_API_KEY = previousFluxArtImageApiKey;
    else delete process.env.FLUXART_IMAGE_API_KEY;
    setRepositoriesForTesting(undefined);
  }
  expect(failureStore.tasks.length === 1, "provider failure should preserve the failed image task for inspection");
  expect(failureStore.creditHolds[0]?.status === "released", "provider failure should release the reserved credit hold");
  expect(failureStore.creditBuckets[0].remainingAmount === 50, "provider failure should restore reserved bucket credits");
  expect(failureStore.ledgerEntries.some(entry => entry.entryType === "release"), "provider failure should write release ledger entries");

  const originalFetch = globalThis.fetch;
  const previousExecutionForProvider = process.env.IMAGE_MODEL_EXECUTION;
  const previousProvider = process.env.IMAGE_MODEL_PROVIDER;
  const previousModel = process.env.IMAGE_MODEL_NAME;
  const previousBaseUrl = process.env.IMAGE_MODEL_BASE_URL;
  const previousKeyRef = process.env.IMAGE_MODEL_API_KEY_SECRET_REF;
  const previousFakeProviderKey = process.env.FAKE_PROVIDER_KEY;
  try {
    const providerImage = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#155e75" } }).png().toBuffer();
    process.env.IMAGE_MODEL_EXECUTION = "live";
    process.env.IMAGE_MODEL_PROVIDER = "custom";
    process.env.IMAGE_MODEL_NAME = "custom-image-model";
    process.env.IMAGE_MODEL_BASE_URL = "https://provider.example.test/v1";
    process.env.IMAGE_MODEL_API_KEY_SECRET_REF = "FAKE_PROVIDER_KEY";
    process.env.FAKE_PROVIDER_KEY = "fake-key";
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ b64_json: providerImage.toString("base64") }] }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "provider-request-1" }
    });
    const liveSubmission = await submitImageGeneration({ taskType: "t2i", prompt: "provider contract", count: 1, size: "16x16", modelProvider: "openai", modelName: "client-requested-model" });
    expect(liveSubmission.provider === "custom" && liveSubmission.modelName === "custom-image-model", "custom provider env should configure the provider seam");
    expect(liveSubmission.modelName !== "client-requested-model", "server provider env should override client model input");
    expect(liveSubmission.providerMode === "sync" && liveSubmission.outputBytes && liveSubmission.outputBytes.length > 0, "OpenAI-compatible b64 output should normalize to synchronous provider bytes");

    let agnesRequestBody: Record<string, unknown> | undefined;
    process.env.IMAGE_MODEL_PROVIDER = "agnes";
    process.env.IMAGE_MODEL_NAME = "agnes-image-2.1-flash";
    process.env.IMAGE_MODEL_BASE_URL = "https://apihub.agnes-ai.com/v1";
    globalThis.fetch = async (_url, init) => {
      agnesRequestBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
      return new Response(JSON.stringify({ data: [{ b64_json: providerImage.toString("base64") }] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "agnes-request-1" }
      });
    };
    const agnesSubmission = await submitImageGeneration({
      taskType: "i2i",
      prompt: "agnes provider contract",
      count: 4,
      size: "16x16",
      sourceAssetId: "asset-source",
      sourceImageUrl: "https://cdn.example.test/source.png",
      stylePreset: "极简产品",
      strength: 78,
      structureMode: "outline"
    });
    expect(agnesSubmission.provider === "agnes" && agnesSubmission.modelName === "agnes-image-2.1-flash", "Agnes provider env should configure the image model seam");
    expect(agnesRequestBody?.model === "agnes-image-2.1-flash", "Agnes requests should use the documented model name");
    expect(typeof agnesRequestBody?.prompt === "string" && agnesRequestBody.prompt.includes("agnes provider contract"), "Agnes requests should forward the task prompt to the image model");
    expect(typeof agnesRequestBody?.prompt === "string" && agnesRequestBody.prompt.includes("Style preset: 极简产品."), "Agnes requests should include the selected style preset in the model prompt");
    expect(typeof agnesRequestBody?.prompt === "string" && agnesRequestBody.prompt.includes("Reference strength: 78 percent."), "Agnes requests should include reference strength in the model prompt");
    expect(agnesRequestBody?.size === "16x16", "Agnes requests should forward the task size to the image model");
    expect(!("n" in (agnesRequestBody || {})), "Agnes requests should not send undocumented n parameter");
    const agnesExtraBody = agnesRequestBody?.extra_body as Record<string, unknown> | undefined;
    expect(agnesExtraBody?.response_format === "url", "Agnes requests should put response_format under extra_body");
    expect(Array.isArray(agnesExtraBody?.image) && agnesExtraBody.image[0] === "https://cdn.example.test/source.png", "Agnes image-to-image requests should send the selected source image URL under extra_body.image");
    expect(agnesExtraBody?.style_preset === "极简产品", "Agnes requests should pass stylePreset as provider metadata");
    expect(agnesExtraBody?.reference_strength === 78, "Agnes requests should pass reference strength as provider metadata");
    expect(agnesExtraBody?.structure_mode === "outline", "Agnes requests should pass structure mode as provider metadata");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousExecutionForProvider) process.env.IMAGE_MODEL_EXECUTION = previousExecutionForProvider;
    else delete process.env.IMAGE_MODEL_EXECUTION;
    if (previousProvider) process.env.IMAGE_MODEL_PROVIDER = previousProvider;
    else delete process.env.IMAGE_MODEL_PROVIDER;
    if (previousModel) process.env.IMAGE_MODEL_NAME = previousModel;
    else delete process.env.IMAGE_MODEL_NAME;
    if (previousBaseUrl) process.env.IMAGE_MODEL_BASE_URL = previousBaseUrl;
    else delete process.env.IMAGE_MODEL_BASE_URL;
    if (previousKeyRef) process.env.IMAGE_MODEL_API_KEY_SECRET_REF = previousKeyRef;
    else delete process.env.IMAGE_MODEL_API_KEY_SECRET_REF;
    if (previousFakeProviderKey) process.env.FAKE_PROVIDER_KEY = previousFakeProviderKey;
    else delete process.env.FAKE_PROVIDER_KEY;
  }

  const capabilityStore = createMockDataStore();
  capabilityStore.users[0].memberStatus = "free";
  capabilityStore.creditBuckets[0].remainingAmount = 100;
  capabilityStore.creditBuckets[0].originalAmount = 100;
  capabilityStore.tasks = [];
  capabilityStore.creditHolds = [];
  capabilityStore.ledgerEntries = [];
  setRepositoriesForTesting(createMockRepositories(capabilityStore));
  try {
    await createTask({ taskType: "outpaint", prompt: "free outpaint should fail", count: 1, size: "1024x1024", sourceAssetId: "IMG-1832" }, capabilityStore.users[0].id);
    throw new Error("expected free outpaint capability failure");
  } catch (error) {
    expect(error instanceof TaskCapabilityError, "free users should be blocked from outpaint task creation");
  } finally {
    setRepositoriesForTesting(undefined);
  }
  expect(capabilityStore.tasks.length === 0, "capability failures should not create image tasks");
  expect(capabilityStore.creditHolds.length === 0, "capability failures should not create credit holds");

  const limitStore = createMockDataStore();
  limitStore.users[0].memberStatus = "free";
  limitStore.creditBuckets[0].remainingAmount = 100;
  limitStore.creditBuckets[0].originalAmount = 100;
  limitStore.creditHolds = [];
  limitStore.ledgerEntries = [];
  limitStore.tasks = [{
    id: "task-active-free",
    userId: limitStore.users[0].id,
    taskType: "t2i",
    status: "queued",
    prompt: "active",
    requestPayload: {},
    modelProvider: "openai",
    modelName: "gpt-image-2",
    chargedCredits: 10,
    priority: 10,
    resultAssetIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }];
  setRepositoriesForTesting(createMockRepositories(limitStore));
  try {
    await createTask({ taskType: "t2i", prompt: "free over limit", count: 1, size: "1024x1024" }, limitStore.users[0].id);
    throw new Error("expected free concurrency failure");
  } catch (error) {
    expect(error instanceof TaskConcurrencyError, "free users should be limited to one active task");
  } finally {
    setRepositoriesForTesting(undefined);
  }
  expect(limitStore.tasks.length === 1, "concurrency failures should not create extra image tasks");
  expect(limitStore.creditHolds.length === 0, "concurrency failures should not create credit holds");

  const creditPackStore = createMockDataStore();
  creditPackStore.users[0].memberStatus = "credit_pack";
  creditPackStore.creditBuckets[0].remainingAmount = 100;
  creditPackStore.creditBuckets[0].originalAmount = 100;
  creditPackStore.tasks = [];
  creditPackStore.creditHolds = [];
  creditPackStore.ledgerEntries = [];
  setRepositoriesForTesting(createMockRepositories(creditPackStore));
  const creditPackTask = await createTask({ taskType: "inpaint", prompt: "credit pack inpaint", count: 1, size: "1024x1024", sourceAssetId: "IMG-1832" }, creditPackStore.users[0].id);
  expect(creditPackTask.status === "queued", "task creation should start in queued state");
  expect(creditPackTask.priority === 50, "credit pack users should store task priority 50");
  expect(creditPackStore.creditHolds[0]?.status === "active", "task creation should leave credit holds active");
  expect(!creditPackStore.ledgerEntries.some(entry => entry.entryType === "spend"), "task creation should not spend credits before approved output");
  await transitionTaskState(creditPackTask.id, "running", creditPackStore.users[0].id);
  await transitionTaskState(creditPackTask.id, "storing", creditPackStore.users[0].id);
  await transitionTaskState(creditPackTask.id, "reviewing", creditPackStore.users[0].id);
  const approvedTask = await transitionTaskState(creditPackTask.id, "succeeded", creditPackStore.users[0].id);
  expect(approvedTask?.status === "succeeded", "approved usable output should transition tasks to succeeded");
  expect(creditPackStore.creditHolds[0]?.status === "spent", "approved usable output should convert active holds to spent");
  expect(creditPackStore.ledgerEntries.some(entry => entry.entryType === "spend"), "approved usable output should write spend ledger entries");
  setRepositoriesForTesting(undefined);

  const paidStore = createMockDataStore();
  paidStore.users[0].memberStatus = "credit_pack";
  paidStore.creditBuckets[0].remainingAmount = 100;
  paidStore.creditBuckets[0].originalAmount = 100;
  paidStore.tasks = [];
  paidStore.creditHolds = [];
  paidStore.ledgerEntries = [];
  setRepositoriesForTesting(createMockRepositories(paidStore));
  const paidTask = await createTask({ taskType: "outpaint", prompt: "credit pack outpaint", count: 1, size: "1024x1024", sourceAssetId: "IMG-1832" }, paidStore.users[0].id);
  expect(paidTask.priority === 50, "credit pack users should store task priority 50");
  await transitionTaskState(paidTask.id, "running", paidStore.users[0].id);
  await transitionTaskState(paidTask.id, "storing", paidStore.users[0].id);
  await transitionTaskState(paidTask.id, "reviewing", paidStore.users[0].id);
  const rejectedTask = await transitionTaskState(paidTask.id, "failed", paidStore.users[0].id, { errorCode: "OUTPUT_REJECTED", errorMessage: "output review rejected" });
  expect(rejectedTask?.status === "failed", "output review failures should transition tasks to failed");
  expect(paidStore.creditHolds[0]?.status === "released", "output review failures should release active holds");
  expect(paidStore.ledgerEntries.some(entry => entry.entryType === "release"), "output review failures should write release ledger entries");
  setRepositoriesForTesting(undefined);

  const task = await repositories.image.createTask({
    userId,
    taskType: "t2i",
    status: "queued",
    prompt: "smoke",
    requestPayload: { size: "1024x1024" },
    modelProvider: "openai",
    modelName: "gpt-image-2",
    chargedCredits: 10,
    priority: 10
  });
  expect(task.id, "Prisma adapter should create a task");
  expect((await repositories.image.getTask(task.id))?.id === task.id, "Prisma adapter should read a task");
  await repositories.image.updateTask(task.id, { status: "running" });
  expect((await repositories.image.getTask(task.id))?.status === "running", "Prisma adapter should update a task");
  const updatedPayloadTask = await repositories.image.updateTask(task.id, {
    requestPayload: {
      size: "1024x1024",
      externalTaskId: "external-smoke",
      providerMode: "sync"
    }
  });
  expect(updatedPayloadTask?.requestPayload.externalTaskId === "external-smoke", "Prisma adapter should map requestPayload updates to requestPayloadJson");
  expect((await repositories.image.listTasks({ userId })).length === 1, "Prisma adapter should list tasks");
  const longFailureReason = `provider failed: ${"x".repeat(500)}`;
  const failedTask = await repositories.image.updateTask(task.id, {
    status: "failed",
    errorMessage: longFailureReason
  });
  expect(failedTask?.status === "failed", "Prisma adapter should update failed tasks with provider errors");
  expect((failedTask?.errorMessage?.length || 0) <= 255, "Prisma adapter should keep failure_reason within the database column limit");
  expect(Boolean(delegates.imageTask.rows.find(row => row.id === task.id)?.failedAt), "Prisma adapter should stamp failedAt when tasks fail");

  const asset = await repositories.image.createAsset({
    id: "asset-smoke",
    userId,
    title: "Smoke asset",
    origin: "generated",
    taskId: task.id,
    taskType: "t2i",
    status: "succeeded",
    prompt: "smoke",
    imageUrl: "https://cdn.example.test/assets/asset-smoke.png",
    objectKey: "assets/smoke/7be91c47-c9e4-48d2-b9fd-5f4720e7b5af.png",
    publicUrl: "https://cdn.example.test/assets/asset-smoke.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    width: 1024,
    height: 1024,
    reviewStatus: "approved",
    downloadState: "not_downloaded",
    modelProvider: "openai",
    modelName: "gpt-image-2",
    entitlementSnapshot: {
      memberStatus: "credit_pack",
      capturedAt: now.toISOString(),
      canDownloadHd: true,
      canDownloadWithoutWatermark: true
    },
    createdAt: now.toISOString()
  });
  expect((await repositories.image.getAsset(asset.id))?.objectKey === asset.objectKey, "Prisma adapter should create/read asset storage metadata");
  expect((await repositories.image.getAsset(asset.id))?.entitlementSnapshot?.memberStatus === "credit_pack", "Prisma adapter should read asset entitlement snapshots");
  await repositories.image.updateAsset(asset.id, { downloadState: "hd" });
  expect((await repositories.image.getAsset(asset.id))?.downloadState === "hd", "Prisma adapter should update assets");
  await repositories.image.updateAsset(asset.id, { status: "failed", reviewStatus: "rejected" });
  expect((await repositories.image.getAsset(asset.id))?.status === "failed", "Prisma adapter should map asset status patches through review status");
  expect((await repositories.image.listAssets({ userId })).length === 1, "Prisma adapter should list assets");
  const cleanupJob = await repositories.image.createAssetCleanupJob({
    id: "cleanup-smoke",
    assetId: asset.id,
    objectKey: asset.objectKey,
    reason: "soft_deleted",
    scheduledAt: now.toISOString(),
    createdAt: now.toISOString()
  });
  expect(cleanupJob.objectKey === asset.objectKey, "Prisma adapter should create asset cleanup jobs");

  const makeRetentionAsset = (userId: string, index: number, createdAt: string): ImageAsset => ({
    id: `retention-${index}`,
    userId,
    title: `Retention ${index}`,
    origin: "generated",
    taskId: `task-retention-${index}`,
    taskType: "t2i",
    status: "succeeded",
    prompt: "retention",
    imageUrl: `https://cdn.example.test/assets/retention-${index}.png`,
    objectKey: `assets/retention/${randomUUID()}.png`,
    publicUrl: `https://cdn.example.test/assets/retention-${index}.png`,
    mimeType: "image/png",
    sizeBytes: 1024,
    width: 1024,
    height: 1024,
    reviewStatus: "approved",
    downloadState: "not_downloaded",
    modelProvider: "openai",
    modelName: "gpt-image-2",
    createdAt
  });
  const retentionStore = createMockDataStore();
  retentionStore.users[0].memberStatus = "free";
  const retentionUserId = retentionStore.users[0].id;
  const retentionNow = new Date();
  retentionStore.assets = [
    ...Array.from({ length: 25 }, (_, index) => makeRetentionAsset(retentionUserId, index, new Date(retentionNow.getTime() - index * 60000).toISOString())),
    makeRetentionAsset(retentionUserId, 99, new Date(retentionNow.getTime() - 8 * 86400000).toISOString())
  ];
  setRepositoriesForTesting(createMockRepositories(retentionStore));
  const retainedAssets = await listAssets({}, retentionUserId);
  expect(retainedAssets.assets.length === 20, "free user visible history should keep at most 20 assets");
  expect(!retainedAssets.assets.some(item => item.id === "retention-99"), "free user visible history should hide assets older than 7 days");
  const deletedRetentionAsset = await deleteAsset("retention-0", retentionUserId);
  expect(typeof deletedRetentionAsset?.deletedAt === "string", "asset deletion should soft-delete with deletedAt");
  expect(retentionStore.cleanupJobs.length === 1, "asset deletion should schedule a later cleanup job");
  const afterDeleteAssets = await listAssets({}, retentionUserId);
  expect(!afterDeleteAssets.assets.some(item => item.id === "retention-0"), "soft-deleted assets should be hidden from user-visible history");
  setRepositoriesForTesting(undefined);

  const generatedStore = createMockDataStore();
  generatedStore.assets = [];
  generatedStore.tasks = [{
    id: "task-generated-storage",
    userId: generatedStore.users[0].id,
    taskType: "t2i",
    status: "storing",
    prompt: "generated storage",
    requestPayload: {},
    modelProvider: "openai",
    modelName: "gpt-image-2",
    chargedCredits: 10,
    priority: 10,
    resultAssetIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }];
  setRepositoriesForTesting(createMockRepositories(generatedStore));
  const generatedAsset = await storeGeneratedAsset({
    task: generatedStore.tasks[0],
    bytes: await sharp({ create: { width: 64, height: 48, channels: 3, background: "#0f766e" } }).png().toBuffer()
  });
  expect(generatedAsset.objectKey.startsWith(`assets/tasks/${generatedStore.tasks[0].id}/asset/`), "generated asset object keys should be task-scoped");
  expect(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i.test(generatedAsset.objectKey), "generated asset object keys should include a UUID");
  expect(generatedAsset.publicUrl.includes(generatedAsset.objectKey), "generated assets should store a public URL");
  expect(generatedAsset.mimeType === "image/png" && generatedAsset.width === 64 && generatedAsset.height === 48 && generatedAsset.sizeBytes > 0, "generated asset records should store MIME type, size, width, and height");
  expect(generatedStore.assets.some(item => item.id === generatedAsset.id), "generated asset storage should create an application-owned asset record");
  setRepositoriesForTesting(undefined);

  const runnerStore = createMockDataStore();
  runnerStore.users[0].memberStatus = "credit_pack";
  runnerStore.creditBuckets[0].remainingAmount = 100;
  runnerStore.creditBuckets[0].originalAmount = 100;
  runnerStore.tasks = [];
  runnerStore.assets = [];
  runnerStore.creditHolds = [];
  runnerStore.ledgerEntries = [];
  runnerStore.providerSubmissions = [];
  runnerStore.providerResults = [];
  setRepositoriesForTesting(createMockRepositories(runnerStore));
  const runnerTask = await createTask({ taskType: "t2i", prompt: "runner success", count: 3, size: "512x512" }, runnerStore.users[0].id);
  expect(runnerStore.providerSubmissions.length === 0, "task creation should queue work without calling the provider");
  const completedRunnerTask = await runImageTask(runnerTask.id, runnerStore.users[0].id);
  expect(runnerStore.providerSubmissions[0]?.providerMode === "sync", "runner seam should record synchronous provider submissions");
  expect(completedRunnerTask?.status === "succeeded", "server runner should move approved provider output to succeeded");
  expect(runnerStore.providerResults[0]?.status === "succeeded", "server runner should record provider success results");
  expect(completedRunnerTask?.resultAssetIds.length === 3, "server runner should attach every approved provider output asset");
  expect(runnerStore.assets.length === 3 && runnerStore.assets.every(asset => asset.reviewStatus === "approved"), "approved provider outputs should create approved visible assets");
  expect(runnerStore.creditHolds[0]?.status === "spent", "approved provider output should convert the credit hold to spend");
  expect(runnerStore.ledgerEntries.some(entry => entry.entryType === "spend"), "approved provider output should write spend ledger entries");
  setRepositoriesForTesting(undefined);

  const approximateDimensionStore = createMockDataStore();
  approximateDimensionStore.users[0].memberStatus = "credit_pack";
  approximateDimensionStore.creditBuckets[0].remainingAmount = 100;
  approximateDimensionStore.creditBuckets[0].originalAmount = 100;
  approximateDimensionStore.tasks = [];
  approximateDimensionStore.assets = [];
  approximateDimensionStore.creditHolds = [];
  approximateDimensionStore.ledgerEntries = [];
  approximateDimensionStore.providerSubmissions = [];
  approximateDimensionStore.providerResults = [];
  setRepositoriesForTesting(createMockRepositories(approximateDimensionStore));
  const previousExecutionForApproximateDimensions = process.env.IMAGE_MODEL_EXECUTION;
  const previousFluxArtImageApiKeyForApproximateDimensions = process.env.FLUXART_IMAGE_API_KEY;
  try {
    const approximateOutput = await sharp({ create: { width: 736, height: 1312, channels: 3, background: "#155e75" } }).png().toBuffer();
    process.env.IMAGE_MODEL_EXECUTION = "live";
    process.env.FLUXART_IMAGE_API_KEY = "fake-key";
    globalThis.fetch = async () => new Response(JSON.stringify({
      data: [{ b64_json: approximateOutput.toString("base64") }]
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "approximate-dimensions-provider-request-1" }
    });
    const approximateDimensionTask = await createTask({ taskType: "i2i", prompt: "runner accepts provider approximate dimensions", count: 1, size: "768x1344", sourceAssetId: "IMG-1832" }, approximateDimensionStore.users[0].id);
    const completedApproximateDimensionTask = await runImageTask(approximateDimensionTask.id, approximateDimensionStore.users[0].id);
    expect(completedApproximateDimensionTask?.status === "succeeded", "provider output with close matching aspect ratio and dimensions should pass output review");
    expect(approximateDimensionStore.assets[0]?.width === 736 && approximateDimensionStore.assets[0]?.height === 1312, "approved approximate provider output should preserve returned dimensions");
    expect(approximateDimensionStore.creditHolds[0]?.status === "spent", "approved approximate provider output should spend the credit hold");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousExecutionForApproximateDimensions) process.env.IMAGE_MODEL_EXECUTION = previousExecutionForApproximateDimensions;
    else delete process.env.IMAGE_MODEL_EXECUTION;
    if (previousFluxArtImageApiKeyForApproximateDimensions) process.env.FLUXART_IMAGE_API_KEY = previousFluxArtImageApiKeyForApproximateDimensions;
    else delete process.env.FLUXART_IMAGE_API_KEY;
    setRepositoriesForTesting(undefined);
  }

  const rejectedRunnerStore = createMockDataStore();
  rejectedRunnerStore.users[0].memberStatus = "credit_pack";
  rejectedRunnerStore.creditBuckets[0].remainingAmount = 100;
  rejectedRunnerStore.creditBuckets[0].originalAmount = 100;
  rejectedRunnerStore.tasks = [];
  rejectedRunnerStore.assets = [];
  rejectedRunnerStore.creditHolds = [];
  rejectedRunnerStore.ledgerEntries = [];
  rejectedRunnerStore.cleanupJobs = [];
  rejectedRunnerStore.providerSubmissions = [];
  rejectedRunnerStore.providerResults = [];
  setRepositoriesForTesting(createMockRepositories(rejectedRunnerStore));
  const rejectedRunnerTask = await createTask({ taskType: "t2i", prompt: "runner rejected placeholder", count: 1, size: "1x1" }, rejectedRunnerStore.users[0].id);
  const failedRunnerTask = await runImageTask(rejectedRunnerTask.id, rejectedRunnerStore.users[0].id);
  const visibleRejectedAssets = await listAssets({}, rejectedRunnerStore.users[0].id);
  expect(failedRunnerTask?.status === "failed" && failedRunnerTask.errorCode === "OUTPUT_REJECTED", "rejected provider output should fail the task with output review metadata");
  expect(rejectedRunnerStore.assets.length === 0, "rejected provider output should not create an ImageAsset");
  expect(visibleRejectedAssets.assets.length === 0, "rejected provider output should not become visible in asset listings");
  expect(rejectedRunnerStore.cleanupJobs[0]?.assetId === rejectedRunnerTask.id, "rejected provider output should schedule stored object cleanup against the task");
  expect(rejectedRunnerStore.creditHolds[0]?.status === "released", "rejected provider output should release the credit hold");
  expect(rejectedRunnerStore.ledgerEntries.some(entry => entry.entryType === "release"), "rejected provider output should write release ledger entries");
  setRepositoriesForTesting(undefined);

  const partialRejectStore = createMockDataStore();
  partialRejectStore.users[0].memberStatus = "credit_pack";
  partialRejectStore.creditBuckets[0].remainingAmount = 100;
  partialRejectStore.creditBuckets[0].originalAmount = 100;
  partialRejectStore.tasks = [];
  partialRejectStore.assets = [];
  partialRejectStore.creditHolds = [];
  partialRejectStore.ledgerEntries = [];
  partialRejectStore.cleanupJobs = [];
  partialRejectStore.providerSubmissions = [];
  partialRejectStore.providerResults = [];
  setRepositoriesForTesting(createMockRepositories(partialRejectStore));
  const previousExecutionForPartialReject = process.env.IMAGE_MODEL_EXECUTION;
  const previousFluxArtImageApiKeyForPartialReject = process.env.FLUXART_IMAGE_API_KEY;
  try {
    const validOutput = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#0f766e" } }).png().toBuffer();
    const invalidDimensionOutput = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#0f172a" } }).png().toBuffer();
    process.env.IMAGE_MODEL_EXECUTION = "live";
    process.env.FLUXART_IMAGE_API_KEY = "fake-key";
    globalThis.fetch = async () => new Response(JSON.stringify({
      data: [
        { b64_json: validOutput.toString("base64") },
        { b64_json: invalidDimensionOutput.toString("base64") }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "partial-reject-provider-request-1" }
    });
    const partialRejectTask = await createTask({ taskType: "t2i", prompt: "runner partial rejected output", count: 2, size: "64x64" }, partialRejectStore.users[0].id);
    const failedPartialRejectTask = await runImageTask(partialRejectTask.id, partialRejectStore.users[0].id);
    expect(failedPartialRejectTask?.status === "succeeded" && failedPartialRejectTask.resultAssetIds.length === 1, "partially rejected provider output should keep approved outputs");
    expect(partialRejectStore.assets.length === 1 && partialRejectStore.assets[0]?.reviewStatus === "approved", "partially rejected provider output should create only approved visible assets");
    expect(partialRejectStore.cleanupJobs.length === 1, "partially rejected provider output should clean up rejected stored outputs");
    expect(partialRejectStore.creditHolds[0]?.status === "spent", "partially rejected provider output should settle the hold");
    expect(partialRejectStore.ledgerEntries.some(entry => entry.entryType === "spend" && entry.amount === -10), "partially rejected provider output should spend approved-output credits");
    expect(partialRejectStore.ledgerEntries.some(entry => entry.entryType === "release" && entry.amount === 10), "partially rejected provider output should release rejected-output credits");
    expect(partialRejectStore.creditBuckets[0].remainingAmount === 90, "partially rejected provider output should restore only rejected-output credits");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousExecutionForPartialReject) process.env.IMAGE_MODEL_EXECUTION = previousExecutionForPartialReject;
    else delete process.env.IMAGE_MODEL_EXECUTION;
    if (previousFluxArtImageApiKeyForPartialReject) process.env.FLUXART_IMAGE_API_KEY = previousFluxArtImageApiKeyForPartialReject;
    else delete process.env.FLUXART_IMAGE_API_KEY;
    setRepositoriesForTesting(undefined);
  }

  const invalidFormatStore = createMockDataStore();
  invalidFormatStore.users[0].memberStatus = "credit_pack";
  invalidFormatStore.creditBuckets[0].remainingAmount = 100;
  invalidFormatStore.creditBuckets[0].originalAmount = 100;
  invalidFormatStore.tasks = [];
  invalidFormatStore.assets = [];
  invalidFormatStore.creditHolds = [];
  invalidFormatStore.ledgerEntries = [];
  invalidFormatStore.cleanupJobs = [];
  invalidFormatStore.providerSubmissions = [];
  invalidFormatStore.providerResults = [];
  setRepositoriesForTesting(createMockRepositories(invalidFormatStore));
  const previousExecutionForInvalidFormat = process.env.IMAGE_MODEL_EXECUTION;
  const previousFluxArtImageApiKeyForInvalidFormat = process.env.FLUXART_IMAGE_API_KEY;
  try {
    process.env.IMAGE_MODEL_EXECUTION = "live";
    process.env.FLUXART_IMAGE_API_KEY = "fake-key";
    globalThis.fetch = async () => new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from("not-an-image").toString("base64") }]
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "invalid-format-provider-request-1" }
    });
    const invalidFormatTask = await createTask({ taskType: "t2i", prompt: "runner invalid provider format", count: 1, size: "64x64" }, invalidFormatStore.users[0].id);
    const failedInvalidFormatTask = await runImageTask(invalidFormatTask.id, invalidFormatStore.users[0].id);
    expect(failedInvalidFormatTask?.status === "failed" && failedInvalidFormatTask.errorCode === "OUTPUT_REJECTED", "invalid provider format should fail as output review rejection");
    expect(failedInvalidFormatTask?.errorMessage?.includes("invalid provider output"), "invalid provider format should report output review rejection");
    expect(invalidFormatStore.providerResults[0]?.status === "succeeded", "invalid provider format should still record provider success before review rejection");
    expect(invalidFormatStore.assets.length === 0, "invalid provider format should not create visible assets");
    expect(invalidFormatStore.creditHolds[0]?.status === "released", "invalid provider format should release the credit hold");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousExecutionForInvalidFormat) process.env.IMAGE_MODEL_EXECUTION = previousExecutionForInvalidFormat;
    else delete process.env.IMAGE_MODEL_EXECUTION;
    if (previousFluxArtImageApiKeyForInvalidFormat) process.env.FLUXART_IMAGE_API_KEY = previousFluxArtImageApiKeyForInvalidFormat;
    else delete process.env.FLUXART_IMAGE_API_KEY;
    setRepositoriesForTesting(undefined);
  }

  const unreadableOutputStore = createMockDataStore();
  unreadableOutputStore.users[0].memberStatus = "credit_pack";
  unreadableOutputStore.creditBuckets[0].remainingAmount = 100;
  unreadableOutputStore.creditBuckets[0].originalAmount = 100;
  unreadableOutputStore.tasks = [];
  unreadableOutputStore.assets = [];
  unreadableOutputStore.creditHolds = [];
  unreadableOutputStore.ledgerEntries = [];
  unreadableOutputStore.cleanupJobs = [];
  unreadableOutputStore.providerSubmissions = [];
  unreadableOutputStore.providerResults = [];
  setRepositoriesForTesting(createMockRepositories(unreadableOutputStore));
  const previousDataModeForReadCheck = process.env.FLUXART_DATA_MODE;
  const previousEndpointForReadCheck = process.env.MINIO_ENDPOINT;
  const previousBucketForReadCheck = process.env.MINIO_BUCKET;
  const previousAccessKeyForReadCheck = process.env.MINIO_ACCESS_KEY;
  const previousSecretKeyForReadCheck = process.env.MINIO_SECRET_KEY;
  const previousExecutionForReadCheck = process.env.IMAGE_MODEL_EXECUTION;
  const previousFluxArtImageApiKeyForReadCheck = process.env.FLUXART_IMAGE_API_KEY;
  try {
    const providerImage = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#1d4ed8" } }).png().toBuffer();
    process.env.FLUXART_DATA_MODE = "prisma";
    process.env.MINIO_ENDPOINT = "https://minio.example.test";
    process.env.MINIO_BUCKET = "fluxart-test";
    process.env.MINIO_ACCESS_KEY = "access";
    process.env.MINIO_SECRET_KEY = "secret";
    process.env.IMAGE_MODEL_EXECUTION = "live";
    process.env.FLUXART_IMAGE_API_KEY = "fake-key";
    globalThis.fetch = async (_url, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ data: [{ b64_json: providerImage.toString("base64") }] }), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "read-check-provider-request-1" }
        });
      }
      if (init?.method === "PUT") return new Response("", { status: 200 });
      if (init?.method === "HEAD") return new Response("", { status: 404 });
      return new Response("", { status: 500 });
    };
    const unreadableOutputTask = await createTask({ taskType: "t2i", prompt: "runner unreadable stored object", count: 1, size: "64x64" }, unreadableOutputStore.users[0].id);
    const failedReadCheckTask = await runImageTask(unreadableOutputTask.id, unreadableOutputStore.users[0].id);
    expect(failedReadCheckTask?.status === "failed" && failedReadCheckTask.errorCode === "OUTPUT_REJECTED", "unreadable stored provider output should fail output review");
    expect(failedReadCheckTask?.errorMessage?.includes("unreadable stored file"), "output review should report unreadable stored files");
    expect(unreadableOutputStore.assets.length === 0, "unreadable stored provider output should not create an ImageAsset");
    expect(unreadableOutputStore.cleanupJobs[0]?.objectKey, "unreadable stored provider output should schedule object cleanup");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDataModeForReadCheck) process.env.FLUXART_DATA_MODE = previousDataModeForReadCheck;
    else delete process.env.FLUXART_DATA_MODE;
    if (previousEndpointForReadCheck) process.env.MINIO_ENDPOINT = previousEndpointForReadCheck;
    else delete process.env.MINIO_ENDPOINT;
    if (previousBucketForReadCheck) process.env.MINIO_BUCKET = previousBucketForReadCheck;
    else delete process.env.MINIO_BUCKET;
    if (previousAccessKeyForReadCheck) process.env.MINIO_ACCESS_KEY = previousAccessKeyForReadCheck;
    else delete process.env.MINIO_ACCESS_KEY;
    if (previousSecretKeyForReadCheck) process.env.MINIO_SECRET_KEY = previousSecretKeyForReadCheck;
    else delete process.env.MINIO_SECRET_KEY;
    if (previousExecutionForReadCheck) process.env.IMAGE_MODEL_EXECUTION = previousExecutionForReadCheck;
    else delete process.env.IMAGE_MODEL_EXECUTION;
    if (previousFluxArtImageApiKeyForReadCheck) process.env.FLUXART_IMAGE_API_KEY = previousFluxArtImageApiKeyForReadCheck;
    else delete process.env.FLUXART_IMAGE_API_KEY;
    setRepositoriesForTesting(undefined);
  }

  const asyncRunnerStore = createMockDataStore();
  asyncRunnerStore.tasks = [{
    id: "task-async-runner",
    userId: asyncRunnerStore.users[0].id,
    taskType: "t2i",
    status: "queued",
    prompt: "async runner",
    requestPayload: { providerMode: "async", externalTaskId: "external-async-runner", size: "1024x1024" },
    modelProvider: "custom",
    modelName: "external-image-model",
    chargedCredits: 10,
    priority: 10,
    resultAssetIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }];
  asyncRunnerStore.providerResults = [];
  asyncRunnerStore.assets = [];
  setRepositoriesForTesting(createMockRepositories(asyncRunnerStore));
  const previousExecutionForAsync = process.env.IMAGE_MODEL_EXECUTION;
  const previousBaseUrlForAsync = process.env.IMAGE_MODEL_BASE_URL;
  const previousFluxArtImageApiKeyForAsync = process.env.FLUXART_IMAGE_API_KEY;
  const previousAsyncResultTemplate = process.env.IMAGE_MODEL_ASYNC_RESULT_URL_TEMPLATE;
  try {
    const asyncProviderImage = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#0f172a" } }).png().toBuffer();
    let asyncResultReady = false;
    process.env.IMAGE_MODEL_EXECUTION = "live";
    process.env.IMAGE_MODEL_BASE_URL = "https://provider.example.test/v1";
    process.env.IMAGE_MODEL_ASYNC_RESULT_URL_TEMPLATE = "https://provider.example.test/v1/images/jobs/{externalTaskId}";
    process.env.FLUXART_IMAGE_API_KEY = "fake-key";
    globalThis.fetch = async (_url, init) => {
      if (init?.method === "GET" && asyncResultReady) {
        return new Response(JSON.stringify({ data: [{ b64_json: asyncProviderImage.toString("base64") }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ data: [{}] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "async-provider-request-1" }
      });
    };
    const pendingRunnerTask = await runImageTask("task-async-runner", asyncRunnerStore.users[0].id);
    expect(pendingRunnerTask?.status === "running", "async provider tasks should remain running while external output is pending");
    expect(asyncRunnerStore.providerResults[0]?.status === "pending", "async provider tasks should normalize pending provider results");
    expect(asyncRunnerStore.assets.length === 0, "async pending provider output should not create visible assets");
    asyncResultReady = true;
    const completedAsyncTask = await runImageTask("task-async-runner", asyncRunnerStore.users[0].id);
    expect(completedAsyncTask?.status === "succeeded", "async provider tasks should complete after result polling returns output");
    expect(asyncRunnerStore.providerResults[0]?.status === "succeeded", "async provider success should record a succeeded provider result");
    expect(asyncRunnerStore.assets[0]?.reviewStatus === "approved", "async provider success should create an approved asset");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousExecutionForAsync) process.env.IMAGE_MODEL_EXECUTION = previousExecutionForAsync;
    else delete process.env.IMAGE_MODEL_EXECUTION;
    if (previousBaseUrlForAsync) process.env.IMAGE_MODEL_BASE_URL = previousBaseUrlForAsync;
    else delete process.env.IMAGE_MODEL_BASE_URL;
    if (previousFluxArtImageApiKeyForAsync) process.env.FLUXART_IMAGE_API_KEY = previousFluxArtImageApiKeyForAsync;
    else delete process.env.FLUXART_IMAGE_API_KEY;
    if (previousAsyncResultTemplate) process.env.IMAGE_MODEL_ASYNC_RESULT_URL_TEMPLATE = previousAsyncResultTemplate;
    else delete process.env.IMAGE_MODEL_ASYNC_RESULT_URL_TEMPLATE;
    setRepositoriesForTesting(undefined);
  }

  const upload = await repositories.image.createUpload({
    id: "upload-smoke",
    userId,
    kind: "source",
    objectKey: "uploads/smoke/597bb7c3-2d55-4e25-b2fa-cad8a4f80d38.png",
    publicUrl: "https://cdn.example.test/uploads/source.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    width: 1024,
    height: 1024,
    validationStatus: "accepted",
    createdAt: now.toISOString()
  });
  expect((await repositories.image.listUploads(userId)).some(item => item.id === upload.id), "Prisma adapter should create/list uploads");

  const submission = await repositories.image.createProviderSubmission({
    id: "submission-smoke",
    taskId: task.id,
    provider: "openai",
    modelName: "gpt-image-2",
    providerMode: "sync",
    requestMetadata: { prompt: "smoke" },
    externalTaskId: "external-smoke",
    createdAt: now.toISOString()
  });
  const providerResult = await repositories.image.createProviderResult({
    id: "provider-result-smoke",
    submissionId: submission.id,
    status: "succeeded",
    rawPayloadDigest: "digest",
    outputMetadata: { count: 1 },
    createdAt: now.toISOString()
  });
  expect(providerResult.submissionId === submission.id, "Prisma adapter should create provider submissions/results");

  const order = await repositories.billing.createOrder({
    userId,
    planId: "credits-500" as BillingPlanId,
    creditsAfterPayment: 550,
    memberStatusAfterPayment: "credit_pack"
  });
  expect(order.outTradeNo, "Prisma adapter should create orders with outTradeNo");
  expect((await repositories.billing.listOrders(userId)).length === 1, "Prisma adapter should list orders");
  expect((await repositories.billing.getOrderByOutTradeNo(order.outTradeNo || ""))?.id === order.orderId, "Prisma adapter should read orders by outTradeNo");
  await repositories.billing.updateOrder(order.orderId, { status: "paid" });
  expect((await repositories.billing.getOrderByOutTradeNo(order.outTradeNo || ""))?.status === "paid", "Prisma adapter should update orders");

  const notification = await repositories.billing.createPaymentNotification({
    id: "notification-smoke",
    orderId: order.orderId,
    providerTradeNo: "provider-trade-smoke",
    verified: true,
    rawPayloadDigest: "notify-digest-smoke",
    receivedAt: now.toISOString(),
    processedAt: now.toISOString()
  });
  expect((await repositories.billing.getPaymentNotificationByDigest(order.orderId, notification.rawPayloadDigest))?.verified === true, "Prisma adapter should create/read payment notifications idempotently");

  const fulfillOrder = await repositories.billing.createOrder({
    userId,
    planId: "credits-500" as BillingPlanId,
    creditsAfterPayment: 550,
    memberStatusAfterPayment: "credit_pack"
  });
  const fulfillmentNotification = {
    id: "notification-fulfillment-smoke",
    orderId: fulfillOrder.orderId,
    providerTradeNo: "provider-trade-fulfillment-smoke",
    verified: true,
    rawPayloadDigest: "notify-digest-fulfillment-smoke",
    receivedAt: now.toISOString(),
    processedAt: now.toISOString()
  };
  const fulfillmentBucket = {
    id: "bucket-fulfillment-smoke",
    userId,
    sourceType: "purchased" as const,
    creditType: "purchased" as const,
    originalAmount: 500,
    remainingAmount: 500,
    validFrom: now.toISOString(),
    validUntil: new Date("2026-07-24T00:00:00.000Z").toISOString(),
    priority: 90,
    sourceOrderId: fulfillOrder.orderId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const fulfillmentLedger = {
    id: "ledger-fulfillment-smoke",
    userId,
    bucketId: fulfillmentBucket.id,
    entryType: "grant" as const,
    amount: 500,
    balanceAfter: 1055,
    sourceRefType: "credit_pack_order",
    sourceRefId: fulfillOrder.orderId,
    label: "Purchased Credit Pack",
    createdAt: now.toISOString()
  };
  const fulfilledOrder = await repositories.billing.fulfillCreditPackOrder({
    order: { id: fulfillOrder.orderId, userId, planId: fulfillOrder.planId, amountCents: fulfillOrder.amountCents || 2900, currency: "CNY", provider: "epay", outTradeNo: fulfillOrder.outTradeNo || "", status: "pending_payment", fulfillmentStatus: "pending", paymentUrl: fulfillOrder.paymentUrl, createdAt: fulfillOrder.createdAt, updatedAt: fulfillOrder.createdAt },
    notification: fulfillmentNotification,
    bucket: fulfillmentBucket,
    ledgerEntry: fulfillmentLedger,
    paidAt: now.toISOString()
  });
  expect(fulfilledOrder.order.status === "paid" && fulfilledOrder.order.fulfillmentStatus === "fulfilled", "credit pack fulfillment should mark orders paid and fulfilled");
  expect((await repositories.credits.listBuckets(userId)).some(item => item.id === fulfillmentBucket.id), "credit pack fulfillment should create a purchased bucket");
  expect((await repositories.credits.listLedgerEntries(userId)).some(entry => entry.id === fulfillmentLedger.id), "credit pack fulfillment should create a ledger grant");
  const duplicateFulfillment = await repositories.billing.fulfillCreditPackOrder({
    order: { id: fulfillOrder.orderId, userId, planId: fulfillOrder.planId, amountCents: fulfillOrder.amountCents || 2900, currency: "CNY", provider: "epay", outTradeNo: fulfillOrder.outTradeNo || "", status: "paid", fulfillmentStatus: "fulfilled", paymentUrl: fulfillOrder.paymentUrl, createdAt: fulfillOrder.createdAt, updatedAt: fulfillOrder.createdAt },
    notification: fulfillmentNotification,
    bucket: { ...fulfillmentBucket, id: "bucket-duplicate-fulfillment-smoke" },
    ledgerEntry: { ...fulfillmentLedger, id: "ledger-duplicate-fulfillment-smoke", bucketId: "bucket-duplicate-fulfillment-smoke" },
    paidAt: now.toISOString()
  });
  expect(duplicateFulfillment.duplicated, "duplicate payment notifications should be idempotent");
  expect(!(await repositories.credits.listBuckets(userId)).some(item => item.id === "bucket-duplicate-fulfillment-smoke"), "duplicate payment notifications should not duplicate purchased buckets");

  const download = await repositories.billing.createDownloadEvent({
    id: "download-smoke",
    assetId: asset.id,
    userId,
    downloadType: "hd_no_watermark",
    creditCost: 0,
    createdAt: now.toISOString()
  });
  expect((await repositories.billing.listDownloadEvents(userId)).some(item => item.id === download.id), "Prisma adapter should create/list download events");

  setPrismaClientForTesting(undefined);
}

run().catch(error => {
  process.stderr.write(`[smoke:repositories:runner] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
