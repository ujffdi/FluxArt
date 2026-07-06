import type { BillingPlanId } from "@/types/billing";
import type { AccountEntitlement, GenerationMode, ImageAsset, ImageGenerationTask, TaskStatus } from "@/types/image";
import type { ModelConfigurationChange, SelectableImageModel } from "@/types/model-config";

export type CreditBucketSourceType = "registration" | "daily_free" | "purchased" | "adjustment";
export type CreditType = "promotional" | "purchased";
export type CreditLedgerEntryType = "grant" | "hold" | "spend" | "refund" | "release" | "adjustment";
export type CreditHoldStatus = "active" | "spent" | "released" | "refunded" | "expired";
export type PaymentFulfillmentStatus = "pending" | "fulfilled" | "failed" | "retryable";
export type ProviderMode = "sync" | "async";
export type ProviderResultStatus = "pending" | "succeeded" | "failed";
export type OutputReviewStatus = "pending" | "approved" | "rejected" | "skipped";
export type UploadKind = "source" | "mask";
export type UploadValidationStatus = "accepted" | "rejected";
export type DownloadType = "standard_watermarked" | "hd_no_watermark";

export type ActiveImageModelConfigurationRecord = SelectableImageModel;

export type ModelConfigurationChangeRecord = ModelConfigurationChange;

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  status: "active" | "disabled";
  memberStatus: AccountEntitlement["memberStatus"];
  preferredImageModelId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserCredentialRecord {
  id: string;
  userId: string;
  username: string;
  passwordHash: string;
  hashVersion: string;
  passwordChangedAt: string;
}

export interface UserSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  slidingExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt?: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthRateLimitBucketRecord {
  id: string;
  scope: string;
  count: number;
  resetAt: string;
  updatedAt: string;
}

export interface CreditBucketRecord {
  id: string;
  userId: string;
  sourceType: CreditBucketSourceType;
  creditType: CreditType;
  originalAmount: number;
  remainingAmount: number;
  validFrom: string;
  validUntil?: string;
  priority: number;
  sourceOrderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditLedgerEntryRecord {
  id: string;
  userId: string;
  bucketId?: string;
  holdId?: string;
  entryType: CreditLedgerEntryType;
  amount: number;
  balanceAfter: number;
  sourceRefType: string;
  sourceRefId?: string;
  label: string;
  createdAt: string;
}

export interface CreditHoldRecord {
  id: string;
  userId: string;
  amount: number;
  status: CreditHoldStatus;
  taskId?: string;
  downloadId?: string;
  expiresAt: string;
  convertedAt?: string;
  refundedAt?: string;
  releasedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderRecord {
  id: string;
  userId: string;
  planId: BillingPlanId;
  amountCents: number;
  currency: "CNY";
  provider: "epay";
  outTradeNo: string;
  status: "pending_payment" | "paid" | "failed" | "refunded";
  fulfillmentStatus: PaymentFulfillmentStatus;
  paymentUrl?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentNotificationRecord {
  id: string;
  orderId: string;
  providerTradeNo?: string;
  verified: boolean;
  rawPayloadDigest: string;
  failureReason?: string;
  receivedAt: string;
  processedAt?: string;
}

export interface ImageUploadRecord {
  id: string;
  userId: string;
  kind: UploadKind;
  objectKey: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  validationStatus: UploadValidationStatus;
  failureReason?: string;
  createdAt: string;
}

export interface ProviderSubmissionRecord {
  id: string;
  taskId: string;
  provider: string;
  modelName: string;
  providerMode: ProviderMode;
  requestMetadata: Record<string, unknown>;
  externalTaskId?: string;
  createdAt: string;
}

export interface ProviderResultRecord {
  id: string;
  submissionId: string;
  status: ProviderResultStatus;
  rawPayloadDigest: string;
  outputMetadata?: Record<string, unknown>;
  errorMetadata?: Record<string, unknown>;
  createdAt: string;
}

export interface DownloadEventRecord {
  id: string;
  assetId: string;
  userId: string;
  downloadType: DownloadType;
  creditCost: number;
  createdAt: string;
}

export interface AssetCleanupJobRecord {
  id: string;
  assetId: string;
  objectKey: string;
  reason: "soft_deleted" | "retention_expired";
  scheduledAt: string;
  completedAt?: string;
  createdAt: string;
}

export interface AppDataStore {
  users: UserRecord[];
  credentials: UserCredentialRecord[];
  sessions: UserSessionRecord[];
  authRateLimitBuckets: AuthRateLimitBucketRecord[];
  creditBuckets: CreditBucketRecord[];
  ledgerEntries: CreditLedgerEntryRecord[];
  creditHolds: CreditHoldRecord[];
  orders: OrderRecord[];
  paymentNotifications: PaymentNotificationRecord[];
  uploads: ImageUploadRecord[];
  tasks: ImageGenerationTask[];
  providerSubmissions: ProviderSubmissionRecord[];
  providerResults: ProviderResultRecord[];
  assets: ImageAsset[];
  downloads: DownloadEventRecord[];
  cleanupJobs: AssetCleanupJobRecord[];
  activeImageModelConfigurations: ActiveImageModelConfigurationRecord[];
  modelConfigurationChanges: ModelConfigurationChangeRecord[];
}

export interface CreateImageTaskRecordInput {
  userId: string;
  taskType: GenerationMode;
  status: TaskStatus;
  prompt: string;
  negativePrompt?: string;
  requestPayload: Record<string, unknown>;
  modelProvider: string;
  modelName: string;
  sourceAssetId?: string;
  chargedCredits: number;
  priority: number;
  creditHoldId?: string;
  resultAssetIds?: string[];
}
