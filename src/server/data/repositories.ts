import { randomUUID } from "node:crypto";
import { account, assets, tasks, versionNodes } from "@/features/flux-art/data/demo-data";
import { billingPlans } from "@/server/billing/plans";
import type { BillingOrder, BillingPlanId } from "@/types/billing";
import type { AccountEntitlement, AssetVersionNode, ImageAsset, ImageGenerationTask } from "@/types/image";
import type { EditableImageModelConfiguration, EditableSelectableImageModel, ModelConfigurationChangeType, ModelConfigurationTestStatus } from "@/types/model-config";
import { createPrismaRepositories } from "./prisma-adapter";
import type {
  ActiveImageModelConfigurationRecord,
  AssetCleanupJobRecord,
  AppDataStore,
  CreditBucketRecord,
  CreditHoldRecord,
  CreditLedgerEntryRecord,
  AuthRateLimitBucketRecord,
  CreateImageTaskRecordInput,
  DownloadEventRecord,
  ImageUploadRecord,
  ModelConfigurationChangeRecord,
  OrderRecord,
  PaymentNotificationRecord,
  ProviderResultRecord,
  ProviderSubmissionRecord,
  UserCredentialRecord,
  UserRecord,
  UserSessionRecord
} from "./records";

export interface ImageRepository {
  listAssets: (options?: { userId?: string; includeDeleted?: boolean }) => Promise<ImageAsset[]>;
  getAsset: (assetId: string) => Promise<ImageAsset | undefined>;
  createAsset: (asset: ImageAsset) => Promise<ImageAsset>;
  updateAsset: (assetId: string, patch: Partial<ImageAsset>) => Promise<ImageAsset | undefined>;
  softDeleteAsset: (assetId: string, deletedAt: string) => Promise<ImageAsset | undefined>;
  listTasks: (options?: { userId?: string }) => Promise<ImageGenerationTask[]>;
  getTask: (taskId: string) => Promise<ImageGenerationTask | undefined>;
  createTask: (task: ImageGenerationTask | CreateImageTaskRecordInput) => Promise<ImageGenerationTask>;
  updateTask: (taskId: string, patch: Partial<ImageGenerationTask>) => Promise<ImageGenerationTask | undefined>;
  listVersionNodes: () => Promise<AssetVersionNode[]>;
  createUpload: (upload: ImageUploadRecord) => Promise<ImageUploadRecord>;
  listUploads: (userId: string) => Promise<ImageUploadRecord[]>;
  createAssetCleanupJob: (job: AssetCleanupJobRecord) => Promise<AssetCleanupJobRecord>;
  createProviderSubmission: (submission: ProviderSubmissionRecord) => Promise<ProviderSubmissionRecord>;
  createProviderResult: (result: ProviderResultRecord) => Promise<ProviderResultRecord>;
}

export interface AccountRepository {
  getCurrentAccount: (userId?: string) => Promise<AccountEntitlement>;
  getUserById: (userId: string) => Promise<UserRecord | undefined>;
  getUserByUsername: (username: string) => Promise<UserRecord | undefined>;
  createUser: (input: { username: string; displayName: string; memberStatus?: AccountEntitlement["memberStatus"] }) => Promise<UserRecord>;
  updateMemberStatus: (userId: string, memberStatus: AccountEntitlement["memberStatus"]) => Promise<UserRecord | undefined>;
  updatePreferredImageModel: (userId: string, preferredImageModelId?: string) => Promise<UserRecord | undefined>;
}

export interface AuthRepository {
  getCredentialByUsername: (username: string) => Promise<UserCredentialRecord | undefined>;
  getCredentialByUserId: (userId: string) => Promise<UserCredentialRecord | undefined>;
  createRegistration: (input: AuthRegistrationInput) => Promise<AuthRegistrationResult>;
  createCredential: (credential: UserCredentialRecord) => Promise<UserCredentialRecord>;
  updatePasswordHash: (userId: string, passwordHash: string, passwordChangedAt: string) => Promise<UserCredentialRecord | undefined>;
  createSession: (session: UserSessionRecord) => Promise<UserSessionRecord>;
  getSessionByTokenHash: (tokenHash: string) => Promise<UserSessionRecord | undefined>;
  touchSession: (sessionId: string, slidingExpiresAt: string) => Promise<UserSessionRecord | undefined>;
  revokeSession: (sessionId: string, revokedAt: string) => Promise<UserSessionRecord | undefined>;
  revokeUserSessions: (userId: string, revokedAt: string) => Promise<number>;
  listActiveSessions: (userId: string, nowIso: string) => Promise<UserSessionRecord[]>;
  consumeRateLimit: (input: { scope: string; now: string; resetAt: string; maxAttempts: number }) => Promise<AuthRateLimitBucketRecord & { allowed: boolean }>;
}

export interface AuthRegistrationInput {
  user: { username: string; displayName: string; memberStatus: AccountEntitlement["memberStatus"] };
  credential: Omit<UserCredentialRecord, "userId" | "username">;
  creditBucket: Omit<CreditBucketRecord, "userId">;
  ledgerEntry: Omit<CreditLedgerEntryRecord, "userId" | "bucketId">;
  session: Omit<UserSessionRecord, "userId">;
}

export interface AuthRegistrationResult {
  user: UserRecord;
  credential: UserCredentialRecord;
  creditBucket: CreditBucketRecord;
  ledgerEntry: CreditLedgerEntryRecord;
  session: UserSessionRecord;
}

export interface CreditRepository {
  listBuckets: (userId: string) => Promise<CreditBucketRecord[]>;
  listLedgerEntries: (userId: string, limit?: number) => Promise<CreditLedgerEntryRecord[]>;
  createDailyFreeGrant: (input: { bucket: CreditBucketRecord; ledgerEntry: CreditLedgerEntryRecord }) => Promise<{ bucket: CreditBucketRecord; ledgerEntry: CreditLedgerEntryRecord } | undefined>;
  reserveCredits: (input: ReserveCreditsInput) => Promise<{ hold: CreditHoldRecord; ledgerEntries: CreditLedgerEntryRecord[] }>;
  finalizeHoldSpend: (input: { holdId: string; now: string; label: string }) => Promise<{ hold: CreditHoldRecord; ledgerEntries: CreditLedgerEntryRecord[] } | undefined>;
  settleHoldPartially: (input: { holdId: string; spendAmount: number; now: string; spendLabel: string; releaseLabel: string }) => Promise<{ hold: CreditHoldRecord; ledgerEntries: CreditLedgerEntryRecord[] } | undefined>;
  releaseHold: (input: { holdId: string; now: string; label: string }) => Promise<{ hold: CreditHoldRecord; ledgerEntries: CreditLedgerEntryRecord[] } | undefined>;
  refundHold: (input: { holdId: string; now: string; label: string }) => Promise<{ hold: CreditHoldRecord; ledgerEntries: CreditLedgerEntryRecord[] } | undefined>;
  createAdjustment: (input: { userId: string; amount: number; now: string; label: string; sourceRefId?: string }) => Promise<{ bucket?: CreditBucketRecord; ledgerEntries: CreditLedgerEntryRecord[] }>;
  createBucket: (bucket: CreditBucketRecord) => Promise<CreditBucketRecord>;
  updateBucket: (bucketId: string, patch: Partial<CreditBucketRecord>) => Promise<CreditBucketRecord | undefined>;
  createLedgerEntry: (entry: CreditLedgerEntryRecord) => Promise<CreditLedgerEntryRecord>;
  createHold: (hold: CreditHoldRecord) => Promise<CreditHoldRecord>;
  updateHold: (holdId: string, patch: Partial<CreditHoldRecord>) => Promise<CreditHoldRecord | undefined>;
  getHold: (holdId: string) => Promise<CreditHoldRecord | undefined>;
}

export interface ReserveCreditsInput {
  userId: string;
  amount: number;
  holdId: string;
  taskId?: string;
  downloadId?: string;
  label: string;
  now: string;
  expiresAt: string;
}

export interface BillingRepository {
  createOrder: (input: CreateOrderRecordInput) => Promise<BillingOrder>;
  createOrderRecord: (order: OrderRecord) => Promise<OrderRecord>;
  getOrderByOutTradeNo: (outTradeNo: string) => Promise<OrderRecord | undefined>;
  updateOrder: (orderId: string, patch: Partial<OrderRecord>) => Promise<OrderRecord | undefined>;
  listOrders: (userId: string) => Promise<OrderRecord[]>;
  createPaymentNotification: (notification: PaymentNotificationRecord) => Promise<PaymentNotificationRecord>;
  getPaymentNotificationByDigest: (orderId: string, rawPayloadDigest: string) => Promise<PaymentNotificationRecord | undefined>;
  fulfillCreditPackOrder: (input: { order: OrderRecord; notification: PaymentNotificationRecord; bucket: CreditBucketRecord; ledgerEntry: CreditLedgerEntryRecord; paidAt: string }) => Promise<{ order: OrderRecord; notification: PaymentNotificationRecord; bucket?: CreditBucketRecord; ledgerEntry?: CreditLedgerEntryRecord; duplicated: boolean }>;
  createDownloadEvent: (event: DownloadEventRecord) => Promise<DownloadEventRecord>;
  listDownloadEvents: (userId: string, options?: { from?: string; downloadType?: DownloadEventRecord["downloadType"] }) => Promise<DownloadEventRecord[]>;
}

export interface SaveActiveModelConfigurationInput {
  config: EditableImageModelConfiguration;
  changedByUserId: string;
  changeType: ModelConfigurationChangeType;
  restoredFromChangeId?: string;
  testStatus?: ModelConfigurationTestStatus;
  testError?: string;
}

export interface SaveSelectableImageModelsInput {
  models: EditableSelectableImageModel[];
  changedByUserId: string;
  changeType: ModelConfigurationChangeType;
  restoredFromChangeId?: string;
  testStatus?: ModelConfigurationTestStatus;
  testError?: string;
}

export interface ModelConfigRepository {
  listConfigurations: () => Promise<ActiveImageModelConfigurationRecord[]>;
  saveConfigurations: (input: SaveSelectableImageModelsInput) => Promise<{ configurations: ActiveImageModelConfigurationRecord[]; change: ModelConfigurationChangeRecord }>;
  getActiveConfiguration: () => Promise<ActiveImageModelConfigurationRecord | undefined>;
  saveActiveConfiguration: (input: SaveActiveModelConfigurationInput) => Promise<{ configuration: ActiveImageModelConfigurationRecord; change: ModelConfigurationChangeRecord }>;
  updateActiveConfigurationTestResult: (input: { modelId?: string; testStatus: Exclude<ModelConfigurationTestStatus, "untested">; testedAt: string; testError?: string; updatedByUserId?: string }) => Promise<ActiveImageModelConfigurationRecord | undefined>;
  listConfigurationChanges: (limit?: number) => Promise<ModelConfigurationChangeRecord[]>;
  getConfigurationChange: (changeId: string) => Promise<ModelConfigurationChangeRecord | undefined>;
}

export interface CreateOrderRecordInput {
  planId: BillingPlanId;
  userId: string;
  creditsAfterPayment: number;
  memberStatusAfterPayment: AccountEntitlement["memberStatus"];
}

export interface AppRepositories {
  image: ImageRepository;
  account: AccountRepository;
  auth: AuthRepository;
  credits: CreditRepository;
  billing: BillingRepository;
  modelConfig: ModelConfigRepository;
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function byCreatedDesc<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function isBucketAvailable(bucket: CreditBucketRecord, current: string) {
  return bucket.remainingAmount > 0 && bucket.validFrom <= current && (!bucket.validUntil || bucket.validUntil > current);
}

function bySpendPriority(left: CreditBucketRecord, right: CreditBucketRecord) {
  return left.priority - right.priority
    || (left.validUntil || "9999").localeCompare(right.validUntil || "9999")
    || left.createdAt.localeCompare(right.createdAt);
}

function toBillingOrder(order: OrderRecord, creditsAfterPayment: number, memberStatusAfterPayment: AccountEntitlement["memberStatus"]): BillingOrder {
  return {
    orderId: order.id,
    planId: order.planId,
    userId: order.userId,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    outTradeNo: order.outTradeNo,
    amountCents: order.amountCents,
    currency: order.currency,
    paymentUrl: order.paymentUrl,
    creditsAfterPayment,
    memberStatusAfterPayment,
    createdAt: order.createdAt
  };
}

export function createMockDataStore(): AppDataStore {
  const createdAt = "2026-06-24T00:00:00.000Z";
  const user: UserRecord = {
    id: account.userId,
    username: "demo",
    displayName: account.displayName,
    status: "active",
    memberStatus: account.memberStatus,
    createdAt,
    updatedAt: createdAt
  };

  const registrationBucket: CreditBucketRecord = {
    id: "bucket-registration-demo",
    userId: user.id,
    sourceType: "registration",
    creditType: "promotional",
    originalAmount: 50,
    remainingAmount: 50,
    validFrom: createdAt,
    validUntil: "2026-09-22T00:00:00.000Z",
    priority: 10,
    createdAt,
    updatedAt: createdAt
  };

  const purchasedBucket: CreditBucketRecord = {
    id: "bucket-purchased-demo",
    userId: user.id,
    sourceType: "purchased",
    creditType: "purchased",
    originalAmount: 1230,
    remainingAmount: 1230,
    validFrom: createdAt,
    validUntil: "2028-06-24T00:00:00.000Z",
    priority: 90,
    createdAt,
    updatedAt: createdAt
  };

  return {
    users: [user],
    credentials: [
      {
        id: "cred-demo",
        userId: user.id,
        username: user.username,
        passwordHash: "scrypt-v1$demo-salt$PkUXVKldxrt2Jc9G40TN8PHcIgmmqIExfKWPYNZLxT3z2tuZoCX8bvi6Llj8yxE9sSPHFDbddFwKdNB_KipPgQ",
        hashVersion: "scrypt-v1",
        passwordChangedAt: createdAt
      }
    ],
    sessions: [],
    authRateLimitBuckets: [],
    creditBuckets: [registrationBucket, purchasedBucket],
    ledgerEntries: [
      {
        id: "ledger-demo-registration",
        userId: user.id,
        bucketId: registrationBucket.id,
        entryType: "grant",
        amount: 50,
        balanceAfter: 50,
        sourceRefType: "registration",
        label: "Registration Credit Grant",
        createdAt
      },
      {
        id: "ledger-demo-purchased",
        userId: user.id,
        bucketId: purchasedBucket.id,
        entryType: "grant",
        amount: 1230,
        balanceAfter: 1280,
        sourceRefType: "purchased",
        label: "Credit Pack grant",
        createdAt
      }
    ],
    creditHolds: [],
    orders: [],
    paymentNotifications: [],
    uploads: [],
    tasks: [...tasks],
    providerSubmissions: [],
    providerResults: [],
    assets: [...assets],
    downloads: [],
    cleanupJobs: [],
    activeImageModelConfigurations: [],
    modelConfigurationChanges: []
  };
}

function editableConfigFromActive(config: ActiveImageModelConfigurationRecord): EditableSelectableImageModel {
  return {
    id: config.id,
    displayName: config.displayName,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKeySecretRef: config.apiKeySecretRef,
    executionMode: config.executionMode,
    requestTimeoutMs: config.requestTimeoutMs,
    enabled: config.enabled,
    isDefault: config.isDefault
  };
}

function defaultModelConfiguration(models: ActiveImageModelConfigurationRecord[]) {
  return models.find(model => model.enabled && model.isDefault) || models.find(model => model.enabled) || models[0];
}

function createTaskRecord(input: ImageGenerationTask | CreateImageTaskRecordInput): ImageGenerationTask {
  if ("id" in input) return input;

  const createdAt = nowIso();
  return {
    id: id("TSK"),
    userId: input.userId,
    taskType: input.taskType,
    status: input.status,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    requestPayload: input.requestPayload,
    modelProvider: input.modelProvider,
    modelName: input.modelName,
    sourceAssetId: input.sourceAssetId,
    chargedCredits: input.chargedCredits,
    priority: input.priority,
    creditHoldId: input.creditHoldId,
    resultAssetIds: input.resultAssetIds || [],
    createdAt,
    updatedAt: createdAt
  };
}

export function createMockRepositories(store: AppDataStore = createMockDataStore()): AppRepositories {
  return {
    image: {
      async listAssets(options = {}) {
        return byCreatedDesc(store.assets.filter(asset => {
          if (options.userId && asset.userId !== options.userId) return false;
          if (!options.includeDeleted && asset.deletedAt) return false;
          return true;
        }));
      },
      async getAsset(assetId) {
        return store.assets.find(asset => asset.id === assetId);
      },
      async createAsset(asset) {
        store.assets.unshift(asset);
        return asset;
      },
      async updateAsset(assetId, patch) {
        const asset = store.assets.find(item => item.id === assetId);
        if (!asset) return undefined;
        Object.assign(asset, patch);
        return asset;
      },
      async softDeleteAsset(assetId, deletedAt) {
        const asset = store.assets.find(item => item.id === assetId);
        if (!asset) return undefined;
        asset.deletedAt = deletedAt;
        return asset;
      },
      async listTasks(options = {}) {
        return byCreatedDesc(store.tasks.filter(task => !options.userId || task.userId === options.userId));
      },
      async getTask(taskId) {
        return store.tasks.find(task => task.id === taskId);
      },
      async createTask(taskInput) {
        const task = createTaskRecord(taskInput);
        store.tasks.unshift(task);
        return task;
      },
      async updateTask(taskId, patch) {
        const task = store.tasks.find(item => item.id === taskId);
        if (!task) return undefined;
        Object.assign(task, patch, { updatedAt: nowIso() });
        return task;
      },
      async listVersionNodes() {
        return versionNodes;
      },
      async createUpload(upload) {
        store.uploads.unshift(upload);
        return upload;
      },
      async listUploads(userId) {
        return byCreatedDesc(store.uploads.filter(upload => upload.userId === userId));
      },
      async createAssetCleanupJob(job) {
        store.cleanupJobs.push(job);
        return job;
      },
      async createProviderSubmission(submission) {
        store.providerSubmissions.unshift(submission);
        return submission;
      },
      async createProviderResult(result) {
        store.providerResults.unshift(result);
        return result;
      }
    },
    account: {
      async getCurrentAccount(userId = account.userId) {
        const user = store.users.find(item => item.id === userId) || store.users[0];
        const current = nowIso();
        const credits = store.creditBuckets
          .filter(bucket => bucket.userId === user.id && bucket.remainingAmount > 0 && bucket.validFrom <= current && (!bucket.validUntil || bucket.validUntil > current))
          .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);

        return {
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          credits,
          memberStatus: user.memberStatus,
          preferredImageModelId: user.preferredImageModelId,
          canUseOutpaint: user.memberStatus === "credit_pack",
          canDownloadHd: user.memberStatus === "credit_pack",
          canDownloadWithoutWatermark: user.memberStatus === "credit_pack"
        };
      },
      async getUserById(userId) {
        return store.users.find(user => user.id === userId);
      },
      async getUserByUsername(username) {
        return store.users.find(user => user.username.toLowerCase() === username.toLowerCase());
      },
      async createUser(input) {
        const createdAt = nowIso();
        const user: UserRecord = {
          id: id("usr"),
          username: input.username.toLowerCase(),
          displayName: input.displayName,
          status: "active",
          memberStatus: input.memberStatus || "free",
          createdAt,
          updatedAt: createdAt
        };
        store.users.push(user);
        return user;
      },
      async updateMemberStatus(userId, memberStatus) {
        const user = store.users.find(item => item.id === userId);
        if (!user) return undefined;
        user.memberStatus = memberStatus;
        user.updatedAt = nowIso();
        return user;
      },
      async updatePreferredImageModel(userId, preferredImageModelId) {
        const user = store.users.find(item => item.id === userId);
        if (!user) return undefined;
        user.preferredImageModelId = preferredImageModelId;
        user.updatedAt = nowIso();
        return user;
      }
    },
    auth: {
      async getCredentialByUsername(username) {
        return store.credentials.find(credential => credential.username.toLowerCase() === username.toLowerCase());
      },
      async getCredentialByUserId(userId) {
        return store.credentials.find(credential => credential.userId === userId);
      },
      async createRegistration(input) {
        const createdAt = nowIso();
        const user: UserRecord = {
          id: id("usr"),
          username: input.user.username.toLowerCase(),
          displayName: input.user.displayName,
          status: "active",
          memberStatus: input.user.memberStatus,
          createdAt,
          updatedAt: createdAt
        };
        const credential: UserCredentialRecord = {
          ...input.credential,
          userId: user.id,
          username: user.username
        };
        const creditBucket: CreditBucketRecord = {
          ...input.creditBucket,
          userId: user.id
        };
        const ledgerEntry: CreditLedgerEntryRecord = {
          ...input.ledgerEntry,
          userId: user.id,
          bucketId: creditBucket.id,
          sourceRefId: input.ledgerEntry.sourceRefId || user.id
        };
        const session: UserSessionRecord = {
          ...input.session,
          userId: user.id
        };

        store.users.push(user);
        store.credentials.push(credential);
        store.creditBuckets.push(creditBucket);
        store.ledgerEntries.push(ledgerEntry);
        store.sessions.push(session);

        return { user, credential, creditBucket, ledgerEntry, session };
      },
      async createCredential(credential) {
        store.credentials.push(credential);
        return credential;
      },
      async updatePasswordHash(userId, passwordHash, passwordChangedAt) {
        const credential = store.credentials.find(item => item.userId === userId);
        if (!credential) return undefined;
        credential.passwordHash = passwordHash;
        credential.passwordChangedAt = passwordChangedAt;
        credential.hashVersion = "scrypt-v1";
        return credential;
      },
      async createSession(session) {
        store.sessions.push(session);
        return session;
      },
      async getSessionByTokenHash(tokenHash) {
        return store.sessions.find(session => session.tokenHash === tokenHash);
      },
      async touchSession(sessionId, slidingExpiresAt) {
        const session = store.sessions.find(item => item.id === sessionId);
        if (!session) return undefined;
        session.slidingExpiresAt = slidingExpiresAt;
        session.updatedAt = nowIso();
        return session;
      },
      async revokeSession(sessionId, revokedAt) {
        const session = store.sessions.find(item => item.id === sessionId);
        if (!session) return undefined;
        session.revokedAt = revokedAt;
        session.updatedAt = revokedAt;
        return session;
      },
      async revokeUserSessions(userId, revokedAt) {
        let count = 0;
        for (const session of store.sessions) {
          if (session.userId === userId && !session.revokedAt) {
            session.revokedAt = revokedAt;
            session.updatedAt = revokedAt;
            count += 1;
          }
        }
        return count;
      },
      async listActiveSessions(userId, now) {
        return store.sessions
          .filter(session => session.userId === userId && !session.revokedAt && session.slidingExpiresAt > now && session.absoluteExpiresAt > now)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
      async consumeRateLimit(input) {
        let bucket = store.authRateLimitBuckets.find(item => item.scope === input.scope);
        if (!bucket || bucket.resetAt <= input.now) {
          bucket = {
            id: id("rate"),
            scope: input.scope,
            count: 1,
            resetAt: input.resetAt,
            updatedAt: input.now
          };
          store.authRateLimitBuckets = store.authRateLimitBuckets.filter(item => item.scope !== input.scope);
          store.authRateLimitBuckets.push(bucket);
          return { ...bucket, allowed: true };
        }

        if (bucket.count >= input.maxAttempts) {
          return { ...bucket, allowed: false };
        }

        bucket.count += 1;
        bucket.updatedAt = input.now;
        return { ...bucket, allowed: true };
      }
    },
    credits: {
      async listBuckets(userId) {
        return store.creditBuckets.filter(bucket => bucket.userId === userId);
      },
      async listLedgerEntries(userId, limit = 20) {
        return byCreatedDesc(store.ledgerEntries.filter(entry => entry.userId === userId)).slice(0, limit);
      },
      async createDailyFreeGrant(input) {
        if (store.creditBuckets.some(bucket => bucket.id === input.bucket.id) || store.ledgerEntries.some(entry => entry.id === input.ledgerEntry.id)) {
          return undefined;
        }
        store.creditBuckets.push(input.bucket);
        store.ledgerEntries.push(input.ledgerEntry);
        return input;
      },
      async reserveCredits(input) {
        const buckets = store.creditBuckets
          .filter(bucket => bucket.userId === input.userId && isBucketAvailable(bucket, input.now))
          .sort(bySpendPriority);
        const available = buckets.reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
        if (available < input.amount) throw new Error("INSUFFICIENT_CREDITS");

        const hold: CreditHoldRecord = {
          id: input.holdId,
          userId: input.userId,
          amount: input.amount,
          status: "active",
          taskId: input.taskId,
          downloadId: input.downloadId,
          expiresAt: input.expiresAt,
          createdAt: input.now,
          updatedAt: input.now
        };
        const ledgerEntries: CreditLedgerEntryRecord[] = [];
        let remaining = input.amount;
        let balanceAfter = available;

        for (const bucket of buckets) {
          if (remaining <= 0) break;
          const deduction = Math.min(bucket.remainingAmount, remaining);
          bucket.remainingAmount -= deduction;
          bucket.updatedAt = input.now;
          remaining -= deduction;
          balanceAfter -= deduction;
          ledgerEntries.push({
            id: id("ledger"),
            userId: input.userId,
            bucketId: bucket.id,
            holdId: hold.id,
            entryType: "hold",
            amount: -deduction,
            balanceAfter,
            sourceRefType: input.taskId ? "image_task" : input.downloadId ? "download" : "credit_hold",
            sourceRefId: input.taskId || input.downloadId || hold.id,
            label: input.label,
            createdAt: input.now
          });
        }

        store.creditHolds.push(hold);
        store.ledgerEntries.push(...ledgerEntries);
        return { hold, ledgerEntries };
      },
      async finalizeHoldSpend(input) {
        const hold = store.creditHolds.find(item => item.id === input.holdId);
        if (!hold || hold.status !== "active") return undefined;
        const holdEntries = store.ledgerEntries.filter(entry => entry.holdId === hold.id && entry.entryType === "hold");
        const balanceAfter = store.creditBuckets
          .filter(bucket => bucket.userId === hold.userId && isBucketAvailable(bucket, input.now))
          .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
        const ledgerEntries = holdEntries.map(holdEntry => ({
          id: id("ledger"),
          userId: hold.userId,
          bucketId: holdEntry.bucketId,
          holdId: hold.id,
          entryType: "spend" as const,
          amount: holdEntry.amount,
          balanceAfter,
              sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
              sourceRefId: hold.taskId || hold.downloadId || hold.id,
          label: input.label,
          createdAt: input.now
        }));

        hold.status = "spent";
        hold.convertedAt = input.now;
        hold.updatedAt = input.now;
        store.ledgerEntries.push(...ledgerEntries);
        return { hold, ledgerEntries };
      },
      async settleHoldPartially(input) {
        const hold = store.creditHolds.find(item => item.id === input.holdId);
        if (!hold || hold.status !== "active") return undefined;
        const holdEntries = store.ledgerEntries.filter(entry => entry.holdId === hold.id && entry.entryType === "hold");
        const ledgerEntries: CreditLedgerEntryRecord[] = [];
        let remainingSpend = Math.max(0, Math.min(input.spendAmount, hold.amount));
        let balanceAfter = store.creditBuckets
          .filter(bucket => bucket.userId === hold.userId && isBucketAvailable(bucket, input.now))
          .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);

        for (const holdEntry of holdEntries) {
          const heldAmount = Math.abs(holdEntry.amount);
          const spendAmount = Math.min(heldAmount, remainingSpend);
          const releaseAmount = heldAmount - spendAmount;
          remainingSpend -= spendAmount;

          if (spendAmount > 0) {
            ledgerEntries.push({
              id: id("ledger"),
              userId: hold.userId,
              bucketId: holdEntry.bucketId,
              holdId: hold.id,
              entryType: "spend",
              amount: -spendAmount,
              balanceAfter,
              sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
              sourceRefId: hold.taskId || hold.downloadId || hold.id,
              label: input.spendLabel,
              createdAt: input.now
            });
          }

          if (releaseAmount > 0 && holdEntry.bucketId) {
            const bucket = store.creditBuckets.find(item => item.id === holdEntry.bucketId);
            if (bucket) {
              bucket.remainingAmount += releaseAmount;
              bucket.updatedAt = input.now;
              balanceAfter += releaseAmount;
            }
            ledgerEntries.push({
              id: id("ledger"),
              userId: hold.userId,
              bucketId: holdEntry.bucketId,
              holdId: hold.id,
              entryType: "release",
              amount: releaseAmount,
              balanceAfter,
              sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
              sourceRefId: hold.taskId || hold.downloadId || hold.id,
              label: input.releaseLabel,
              createdAt: input.now
            });
          }
        }

        hold.status = "spent";
        hold.convertedAt = input.now;
        hold.updatedAt = input.now;
        store.ledgerEntries.push(...ledgerEntries);
        return { hold, ledgerEntries };
      },
      async releaseHold(input) {
        const hold = store.creditHolds.find(item => item.id === input.holdId);
        if (!hold || hold.status !== "active") return undefined;
        const holdEntries = store.ledgerEntries.filter(entry => entry.holdId === hold.id && entry.entryType === "hold");
        const ledgerEntries: CreditLedgerEntryRecord[] = [];
        let balanceAfter = store.creditBuckets
          .filter(bucket => bucket.userId === hold.userId && isBucketAvailable(bucket, input.now))
          .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);

        for (const holdEntry of holdEntries) {
          if (!holdEntry.bucketId) continue;
          const bucket = store.creditBuckets.find(item => item.id === holdEntry.bucketId);
          if (!bucket) continue;
          const releaseAmount = Math.abs(holdEntry.amount);
          bucket.remainingAmount += releaseAmount;
          bucket.updatedAt = input.now;
          balanceAfter += releaseAmount;
          ledgerEntries.push({
            id: id("ledger"),
            userId: hold.userId,
            bucketId: bucket.id,
            holdId: hold.id,
            entryType: "release",
            amount: releaseAmount,
            balanceAfter,
            sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
            sourceRefId: hold.taskId || hold.downloadId || hold.id,
            label: input.label,
            createdAt: input.now
          });
        }

        hold.status = "released";
        hold.releasedAt = input.now;
        hold.updatedAt = input.now;
        store.ledgerEntries.push(...ledgerEntries);
        return { hold, ledgerEntries };
      },
      async refundHold(input) {
        const hold = store.creditHolds.find(item => item.id === input.holdId);
        if (!hold || hold.status !== "spent") return undefined;
        const holdEntries = store.ledgerEntries.filter(entry => entry.holdId === hold.id && entry.entryType === "hold");
        const ledgerEntries: CreditLedgerEntryRecord[] = [];
        let balanceAfter = store.creditBuckets
          .filter(bucket => bucket.userId === hold.userId && isBucketAvailable(bucket, input.now))
          .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);

        for (const holdEntry of holdEntries) {
          if (!holdEntry.bucketId) continue;
          const bucket = store.creditBuckets.find(item => item.id === holdEntry.bucketId);
          if (!bucket) continue;
          const refundAmount = Math.abs(holdEntry.amount);
          bucket.remainingAmount += refundAmount;
          bucket.updatedAt = input.now;
          balanceAfter += refundAmount;
          ledgerEntries.push({
            id: id("ledger"),
            userId: hold.userId,
            bucketId: bucket.id,
            holdId: hold.id,
            entryType: "refund",
            amount: refundAmount,
            balanceAfter,
            sourceRefType: hold.taskId ? "image_task" : hold.downloadId ? "download" : "credit_hold",
            sourceRefId: hold.taskId || hold.downloadId || hold.id,
            label: input.label,
            createdAt: input.now
          });
        }

        hold.status = "refunded";
        hold.refundedAt = input.now;
        hold.updatedAt = input.now;
        store.ledgerEntries.push(...ledgerEntries);
        return { hold, ledgerEntries };
      },
      async createAdjustment(input) {
        const currentBalance = store.creditBuckets
          .filter(bucket => bucket.userId === input.userId && isBucketAvailable(bucket, input.now))
          .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
        if (input.amount === 0) return { ledgerEntries: [] };

        if (input.amount > 0) {
          const bucket: CreditBucketRecord = {
            id: id("bucket"),
            userId: input.userId,
            sourceType: "adjustment",
            creditType: "promotional",
            originalAmount: input.amount,
            remainingAmount: input.amount,
            validFrom: input.now,
            priority: 20,
            createdAt: input.now,
            updatedAt: input.now
          };
          const ledgerEntry: CreditLedgerEntryRecord = {
            id: id("ledger"),
            userId: input.userId,
            bucketId: bucket.id,
            entryType: "adjustment",
            amount: input.amount,
            balanceAfter: currentBalance + input.amount,
            sourceRefType: "manual_adjustment",
            sourceRefId: input.sourceRefId,
            label: input.label,
            createdAt: input.now
          };
          store.creditBuckets.push(bucket);
          store.ledgerEntries.push(ledgerEntry);
          return { bucket, ledgerEntries: [ledgerEntry] };
        }

        const buckets = store.creditBuckets
          .filter(bucket => bucket.userId === input.userId && isBucketAvailable(bucket, input.now))
          .sort(bySpendPriority);
        const debitAmount = Math.abs(input.amount);
        if (currentBalance < debitAmount) throw new Error("INSUFFICIENT_CREDITS");

        const ledgerEntries: CreditLedgerEntryRecord[] = [];
        let remaining = debitAmount;
        let balanceAfter = currentBalance;
        for (const bucket of buckets) {
          if (remaining <= 0) break;
          const deduction = Math.min(bucket.remainingAmount, remaining);
          bucket.remainingAmount -= deduction;
          bucket.updatedAt = input.now;
          remaining -= deduction;
          balanceAfter -= deduction;
          ledgerEntries.push({
            id: id("ledger"),
            userId: input.userId,
            bucketId: bucket.id,
            entryType: "adjustment",
            amount: -deduction,
            balanceAfter,
            sourceRefType: "manual_adjustment",
            sourceRefId: input.sourceRefId,
            label: input.label,
            createdAt: input.now
          });
        }
        store.ledgerEntries.push(...ledgerEntries);
        return { ledgerEntries };
      },
      async createBucket(bucket) {
        store.creditBuckets.push(bucket);
        return bucket;
      },
      async updateBucket(bucketId, patch) {
        const bucket = store.creditBuckets.find(item => item.id === bucketId);
        if (!bucket) return undefined;
        Object.assign(bucket, patch, { updatedAt: nowIso() });
        return bucket;
      },
      async createLedgerEntry(entry) {
        store.ledgerEntries.push(entry);
        return entry;
      },
      async createHold(hold) {
        store.creditHolds.push(hold);
        return hold;
      },
      async updateHold(holdId, patch) {
        const hold = store.creditHolds.find(item => item.id === holdId);
        if (!hold) return undefined;
        Object.assign(hold, patch, { updatedAt: nowIso() });
        return hold;
      },
      async getHold(holdId) {
        return store.creditHolds.find(hold => hold.id === holdId);
      }
    },
    billing: {
      async createOrder(input) {
        const plan = billingPlans[input.planId];
        const createdAt = nowIso();
        const order: OrderRecord = {
          id: id("ORD"),
          planId: input.planId,
          userId: input.userId,
          amountCents: plan.amountCents,
          currency: "CNY",
          provider: "epay",
          outTradeNo: `FA${Date.now()}${Math.floor(Math.random() * 1000)}`,
          status: "pending_payment",
          fulfillmentStatus: "pending",
          paymentUrl: `/workspace/billing?outTradeNo=${encodeURIComponent(`pending-${Date.now()}`)}`,
          createdAt,
          updatedAt: createdAt
        };
        store.orders.unshift(order);
        return toBillingOrder(order, input.creditsAfterPayment, input.memberStatusAfterPayment);
      },
      async createOrderRecord(order) {
        store.orders.unshift(order);
        return order;
      },
      async getOrderByOutTradeNo(outTradeNo) {
        return store.orders.find(order => order.outTradeNo === outTradeNo);
      },
      async updateOrder(orderId, patch) {
        const order = store.orders.find(item => item.id === orderId);
        if (!order) return undefined;
        Object.assign(order, patch, { updatedAt: nowIso() });
        return order;
      },
      async listOrders(userId) {
        return byCreatedDesc(store.orders.filter(order => order.userId === userId));
      },
      async createPaymentNotification(notification) {
        store.paymentNotifications.push(notification);
        return notification;
      },
      async getPaymentNotificationByDigest(orderId, rawPayloadDigest) {
        return store.paymentNotifications.find(notification => notification.orderId === orderId && notification.rawPayloadDigest === rawPayloadDigest);
      },
      async fulfillCreditPackOrder(input) {
        const existingNotification = store.paymentNotifications.find(notification => notification.orderId === input.order.id);
        const order = store.orders.find(item => item.id === input.order.id);
        if (!order) throw new Error("ORDER_NOT_FOUND");
        if (existingNotification || order.fulfillmentStatus === "fulfilled") {
          return { order, notification: existingNotification || input.notification, duplicated: true };
        }

        store.paymentNotifications.push(input.notification);
        store.creditBuckets.push(input.bucket);
        store.ledgerEntries.push(input.ledgerEntry);
        Object.assign(order, {
          status: "paid" as const,
          fulfillmentStatus: "fulfilled" as const,
          paidAt: input.paidAt,
          updatedAt: input.paidAt
        });
        return { order, notification: input.notification, bucket: input.bucket, ledgerEntry: input.ledgerEntry, duplicated: false };
      },
      async createDownloadEvent(event) {
        store.downloads.push(event);
        return event;
      },
      async listDownloadEvents(userId, options = {}) {
        return byCreatedDesc(store.downloads.filter(event => {
          if (event.userId !== userId) return false;
          if (options.from && event.createdAt < options.from) return false;
          if (options.downloadType && event.downloadType !== options.downloadType) return false;
          return true;
        }));
      }
    },
    modelConfig: {
      async listConfigurations() {
        return [...store.activeImageModelConfigurations];
      },
      async saveConfigurations(input) {
        const now = nowIso();
        const beforeConfig = store.activeImageModelConfigurations.length
          ? store.activeImageModelConfigurations.map(editableConfigFromActive)
          : undefined;
        const previousCreatedAt = new Map(store.activeImageModelConfigurations.map(model => [model.id, model.createdAt]));
        const configurations: ActiveImageModelConfigurationRecord[] = input.models.map(model => ({
          ...model,
          lastTestStatus: input.testStatus || "untested",
          lastTestError: input.testError,
          updatedByUserId: input.changedByUserId,
          createdAt: previousCreatedAt.get(model.id) || now,
          updatedAt: now
        }));
        store.activeImageModelConfigurations = configurations;
        const change: ModelConfigurationChangeRecord = {
          id: id("model-change"),
          changedByUserId: input.changedByUserId,
          changeType: input.changeType,
          beforeConfig,
          afterConfig: input.models,
          testStatus: input.testStatus || "untested",
          testError: input.testError,
          restoredFromChangeId: input.restoredFromChangeId,
          createdAt: now
        };
        store.modelConfigurationChanges.unshift(change);
        return { configurations, change };
      },
      async getActiveConfiguration() {
        return defaultModelConfiguration(store.activeImageModelConfigurations);
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
        const configuration = defaultModelConfiguration(result.configurations) || result.configurations[0];
        return { configuration, change: result.change };
      },
      async updateActiveConfigurationTestResult(input) {
        const configuration = input.modelId
          ? store.activeImageModelConfigurations.find(model => model.id === input.modelId)
          : defaultModelConfiguration(store.activeImageModelConfigurations);
        if (!configuration) return undefined;
        configuration.lastTestStatus = input.testStatus;
        configuration.lastTestedAt = input.testedAt;
        configuration.lastTestError = input.testError;
        configuration.updatedByUserId = input.updatedByUserId || configuration.updatedByUserId;
        configuration.updatedAt = input.testedAt;
        return configuration;
      },
      async listConfigurationChanges(limit = 10) {
        return store.modelConfigurationChanges.slice(0, limit);
      },
      async getConfigurationChange(changeId) {
        return store.modelConfigurationChanges.find(change => change.id === changeId);
      }
    }
  };
}

const mockRepositories = createMockRepositories();
let testRepositories: AppRepositories | undefined;

export function setRepositoriesForTesting(repositories: AppRepositories | undefined) {
  testRepositories = repositories;
}

function getDataMode() {
  if (process.env.NODE_ENV === "production" && !process.env.FLUXART_DATA_MODE && !process.env.APP_DATA_MODE) {
    return "production-unconfigured";
  }
  return process.env.FLUXART_DATA_MODE || process.env.APP_DATA_MODE || "mock";
}

export function getRepositories(): AppRepositories {
  if (testRepositories) return testRepositories;
  const mode = getDataMode();
  if (mode === "mock") return mockRepositories;
  if (mode === "prisma") return createPrismaRepositories();

  throw new Error(
    `Unsupported FLUXART_DATA_MODE=${mode}. Production deployments must set FLUXART_DATA_MODE=prisma and initialize the Prisma adapter from prisma/schema.prisma.`
  );
}
