import { randomUUID } from "node:crypto";
import { billingPlans } from "@/server/billing/plans";
import type { BillingOrder } from "@/types/billing";
import type { AccountEntitlement, ImageAsset, ImageGenerationTask } from "@/types/image";
import type { AppRepositories } from "./repositories";
import type { CreditLedgerEntryRecord } from "./records";

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
  membershipPlan: PrismaDelegate;
  membershipCycle: PrismaDelegate;
  imageUpload: PrismaDelegate;
  imageTask: PrismaDelegate;
  providerSubmission: PrismaDelegate;
  providerResult: PrismaDelegate;
  imageAsset: PrismaDelegate;
  assetVersionNode: PrismaDelegate;
  downloadEvent: PrismaDelegate;
  assetCleanupJob: PrismaDelegate;
}

let prismaClientPromise: Promise<PrismaClientLike> | undefined;
let testPrismaClient: PrismaClientLike | undefined;

export function setPrismaClientForTesting(client: PrismaClientLike | undefined) {
  testPrismaClient = client;
  prismaClientPromise = undefined;
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

function toIso(value: RecordValue | undefined) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function asString(value: RecordValue | undefined, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: RecordValue | undefined, fallback = 0) {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : fallback;
}

function asJsonObject(value: RecordValue | undefined): Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value) ? value : {};
}

function entitlementSnapshotFromRecord(value: RecordValue | undefined): ImageAsset["entitlementSnapshot"] {
  const snapshot = asJsonObject(value);
  const memberStatus = snapshot.memberStatus;
  if (
    (memberStatus !== "free" && memberStatus !== "credit_pack" && memberStatus !== "pro_trial" && memberStatus !== "pro") ||
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
    canDownloadWithoutWatermark: snapshot.canDownloadWithoutWatermark,
    commercialAuthorizationStatement: typeof snapshot.commercialAuthorizationStatement === "string" ? snapshot.commercialAuthorizationStatement : undefined
  };
}

function accountFromUser(user: DbRecord, credits: number, username: string, activeCycle?: DbRecord): AccountEntitlement {
  const memberStatus = activeCycle ? "pro" : asString(user.memberStatus, "free") as AccountEntitlement["memberStatus"];
  const cycleEnd = activeCycle?.cycleEnd;

  return {
    userId: asString(user.id),
    username,
    displayName: asString(user.displayName, "FluxArt User"),
    credits,
    memberStatus,
    proDaysRemaining: typeof cycleEnd === "string" || cycleEnd instanceof Date
      ? Math.max(0, Math.ceil((Date.parse(toIso(cycleEnd)) - Date.now()) / 86400000))
      : 0,
    canUseOutpaint: memberStatus === "pro" || memberStatus === "pro_trial",
    canDownloadHd: memberStatus === "pro" || memberStatus === "pro_trial",
    canDownloadWithoutWatermark: memberStatus === "pro" || memberStatus === "pro_trial"
  };
}

function assetFromRecord(record: DbRecord): ImageAsset {
  const reviewStatus = asString(record.reviewStatus, "approved");
  const deletedAt = record.deletedAt ? toIso(record.deletedAt) : undefined;
  const status = reviewStatus === "approved" ? "succeeded" : reviewStatus === "rejected" ? "failed" : "reviewing";

  return {
    id: asString(record.id),
    userId: asString(record.userId),
    title: asString(record.title, "FluxArt asset"),
    taskId: asString(record.taskId),
    taskType: asString(record.taskType, "t2i") as ImageAsset["taskType"],
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
    commercialAuthorizationStatement: asString(record.commercialAuthorizationStatement) || undefined,
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
    sourceType: asString(record.sourceType, "adjustment") as "registration" | "daily_free" | "purchased" | "membership" | "adjustment",
    creditType: asString(record.creditType, "promotional") as "promotional" | "purchased",
    originalAmount: asNumber(record.originalAmount),
    remainingAmount: asNumber(record.remainingAmount),
    validFrom: toIso(record.validFrom),
    validUntil: record.validUntil ? toIso(record.validUntil) : undefined,
    priority: asNumber(record.priority),
    sourceOrderId: asString(record.sourceOrderId) || undefined,
    membershipCycleId: asString(record.membershipCycleId) || undefined,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt)
  };
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
            title: asset.title,
            taskType: asset.taskType,
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
            entitlementSnapshotJson: asset.entitlementSnapshot || undefined,
            commercialAuthorizationStatement: asset.commercialAuthorizationStatement || null
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
          delete data.status;
        }
        delete data.resultAssetIds;
        const record = await prisma.imageTask.update?.({ where: { id: taskId }, data });
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
        const activeCycle = await prisma.membershipCycle.findFirst?.({
          where: { userId: asString(user.id), status: "active", cycleStart: { lte: new Date() }, cycleEnd: { gt: new Date() } },
          orderBy: { cycleEnd: "desc" }
        });
        return accountFromUser(user, credits, asString(credential?.username), activeCycle || undefined);
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
        const run = prisma.$transaction || (async fn => fn(prisma));

        return run(async tx => {
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
            input.resetAt,
            input.now,
            input.now,
            input.now
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
              data: { count: 1, resetAt: input.resetAt, updatedAt: input.now }
              })
              : await prisma.authRateLimitBucket.create({
              data: {
                scope: input.scope,
                count: 1,
                resetAt: input.resetAt,
                updatedAt: input.now
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
              data: { count: { increment: 1 }, updatedAt: input.now }
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
        const run = prisma.$transaction || (async fn => fn(prisma));
        return run(async tx => {
          const now = input.now;
          const rawBuckets = tx.$queryRawUnsafe
            ? await tx.$queryRawUnsafe(
              `SELECT id, user_id AS userId, source_type AS sourceType, credit_type AS creditType,
                      original_amount AS originalAmount, remaining_amount AS remainingAmount,
                      valid_from AS validFrom, valid_until AS validUntil, priority,
                      source_order_id AS sourceOrderId, membership_cycle_id AS membershipCycleId,
                      created_at AS createdAt, updated_at AS updatedAt
               FROM credit_buckets
               WHERE user_id = ? AND remaining_amount > 0 AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)
               ORDER BY priority ASC, COALESCE(valid_until, '9999-12-31') ASC, created_at ASC
               FOR UPDATE`,
              input.userId,
              now,
              now
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
                input.now,
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
        const run = prisma.$transaction || (async fn => fn(prisma));
        return run(async tx => {
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
        const run = prisma.$transaction || (async fn => fn(prisma));
        return run(async tx => {
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
                  await tx.$executeRawUnsafe("UPDATE credit_buckets SET remaining_amount = remaining_amount + ?, updated_at = ? WHERE id = ?", releaseAmount, input.now, bucketId);
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
        const run = prisma.$transaction || (async fn => fn(prisma));
        return run(async tx => {
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
                input.now,
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
        const run = prisma.$transaction || (async fn => fn(prisma));
        return run(async tx => {
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
                input.now,
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
        const run = prisma.$transaction || (async fn => fn(prisma));
        return run(async tx => {
          const rawBuckets = tx.$queryRawUnsafe
            ? await tx.$queryRawUnsafe(
              `SELECT id, user_id AS userId, source_type AS sourceType, credit_type AS creditType,
                      original_amount AS originalAmount, remaining_amount AS remainingAmount,
                      valid_from AS validFrom, valid_until AS validUntil, priority,
                      source_order_id AS sourceOrderId, membership_cycle_id AS membershipCycleId,
                      created_at AS createdAt, updated_at AS updatedAt
               FROM credit_buckets
               WHERE user_id = ? AND remaining_amount > 0 AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)
               ORDER BY priority ASC, COALESCE(valid_until, '9999-12-31') ASC, created_at ASC
               FOR UPDATE`,
              input.userId,
              input.now,
              input.now
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
                input.now,
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
        const run = prisma.$transaction || (async fn => fn(prisma));
        return run(async tx => {
          const existingNotification = await tx.paymentNotification.findFirst?.({
            where: { orderId: input.order.id }
          });
          const orderRecord = await tx.order.findUnique?.({ where: { id: input.order.id } });
          if (!orderRecord) throw new Error("ORDER_NOT_FOUND");
          const orderStatus = asString(orderRecord.fulfillmentStatus, "pending");
          if (existingNotification || orderStatus === "fulfilled") {
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
      async fulfillMembershipOrder(input) {
        const prisma = await getPrismaClient();
        const run = prisma.$transaction || (async fn => fn(prisma));
        return run(async tx => {
          const existingNotification = await tx.paymentNotification.findFirst?.({
            where: { orderId: input.order.id }
          });
          const orderRecord = await tx.order.findUnique?.({ where: { id: input.order.id } });
          if (!orderRecord) throw new Error("ORDER_NOT_FOUND");
          const orderStatus = asString(orderRecord.fulfillmentStatus, "pending");
          if (existingNotification || orderStatus === "fulfilled") {
            return {
              order: {
                id: asString(orderRecord.id),
                userId: asString(orderRecord.userId),
                planId: asString(orderRecord.planId, "pro-monthly") as BillingOrder["planId"],
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
            return {
              order: {
                id: asString(claimedOrder?.id || input.order.id),
                userId: asString(claimedOrder?.userId || input.order.userId),
                planId: asString(claimedOrder?.planId || input.order.planId, "pro-monthly") as BillingOrder["planId"],
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

          const plan = await tx.membershipPlan.findUnique?.({ where: { code: input.cycle.planCode } });
          if (!plan) throw new Error("MEMBERSHIP_PLAN_NOT_FOUND");
          await tx.paymentNotification.create({ data: input.notification });
          await tx.membershipCycle.create({
            data: {
              id: input.cycle.id,
              userId: input.cycle.userId,
              planId: asString(plan.id),
              orderId: input.cycle.orderId,
              cycleStart: input.cycle.cycleStart,
              cycleEnd: input.cycle.cycleEnd,
              status: input.cycle.status,
              hdDownloadsUsed: input.cycle.hdDownloadsUsed,
              hdFairUseCap: input.cycle.hdFairUseCap,
              createdAt: input.cycle.createdAt,
              updatedAt: input.cycle.updatedAt
            }
          });
          await tx.creditBucket.create({ data: input.bucket });
          await tx.creditLedgerEntry.create({ data: input.ledgerEntry });
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
              planId: asString(order.planId, "pro-monthly") as BillingOrder["planId"],
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
            cycle: input.cycle,
            bucket: input.bucket,
            ledgerEntry: input.ledgerEntry,
            duplicated: false
          };
        });
      },
      async createMembershipCycle(cycle) {
        const prisma = await getPrismaClient();
        const plan = await prisma.membershipPlan.findUnique?.({ where: { code: cycle.planCode } });
        const planId = asString(plan?.id, cycle.planCode);
        await prisma.membershipCycle.create({
          data: {
            id: cycle.id,
            userId: cycle.userId,
            planId,
            orderId: cycle.orderId || null,
            cycleStart: cycle.cycleStart,
            cycleEnd: cycle.cycleEnd,
            status: cycle.status,
            hdDownloadsUsed: cycle.hdDownloadsUsed,
            hdFairUseCap: cycle.hdFairUseCap,
            createdAt: cycle.createdAt,
            updatedAt: cycle.updatedAt
          }
        });
        return cycle;
      },
      async updateMembershipCycle(cycleId, patch) {
        const prisma = await getPrismaClient();
        const data: Record<string, unknown> = { ...patch };
        if (patch.planCode) {
          const plan = await prisma.membershipPlan.findUnique?.({ where: { code: patch.planCode } });
          data.planId = asString(plan?.id, patch.planCode);
          delete data.planCode;
        }
        await prisma.membershipCycle.update?.({ where: { id: cycleId }, data });
        return { id: cycleId, userId: "", planCode: "pro-monthly", cycleStart: "", cycleEnd: "", status: "active", hdDownloadsUsed: 0, hdFairUseCap: 300, createdAt: "", updatedAt: "", ...patch };
      },
      async consumeMembershipDownload(cycleId, now) {
        const prisma = await getPrismaClient();
        const result = await prisma.membershipCycle.updateMany?.({
          where: {
            id: cycleId,
            status: "active",
            cycleStart: { lte: new Date(now) },
            cycleEnd: { gt: new Date(now) },
            hdDownloadsUsed: { lt: 300 }
          },
          data: { hdDownloadsUsed: { increment: 1 }, updatedAt: now }
        });
        if (!result || result.count === 0) return undefined;
        const record = await prisma.membershipCycle.findUnique?.({ where: { id: cycleId } });
        if (!record) return undefined;
        return {
          id: asString(record.id),
          userId: asString(record.userId),
          planCode: "pro-monthly",
          orderId: asString(record.orderId) || undefined,
          cycleStart: toIso(record.cycleStart),
          cycleEnd: toIso(record.cycleEnd),
          status: asString(record.status, "active") as "active" | "expired" | "cancelled",
          hdDownloadsUsed: asNumber(record.hdDownloadsUsed),
          hdFairUseCap: asNumber(record.hdFairUseCap, 300),
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        };
      },
      async listMembershipCycles(userId) {
        const prisma = await getPrismaClient();
        const records = await prisma.membershipCycle.findMany({ where: { userId }, orderBy: { cycleEnd: "desc" } });
        return records.map(record => ({
          id: asString(record.id),
          userId: asString(record.userId),
          planCode: "pro-monthly",
          orderId: asString(record.orderId) || undefined,
          cycleStart: toIso(record.cycleStart),
          cycleEnd: toIso(record.cycleEnd),
          status: asString(record.status, "active") as "active" | "expired" | "cancelled",
          hdDownloadsUsed: asNumber(record.hdDownloadsUsed),
          hdFairUseCap: asNumber(record.hdFairUseCap, 300),
          createdAt: toIso(record.createdAt),
          updatedAt: toIso(record.updatedAt)
        }));
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
          proFairUseApplied: record.proFairUseApplied === true,
          membershipCycleId: asString(record.membershipCycleId) || undefined,
          createdAt: toIso(record.createdAt)
        }));
      }
    }
  };
}
