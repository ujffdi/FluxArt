export type GenerationMode = "t2i" | "i2i" | "inpaint" | "outpaint";

export const generationModes = ["t2i", "i2i", "inpaint", "outpaint"] as const;

export type StructureMode = "balanced" | "outline" | "pose";

export const structureModes = ["balanced", "outline", "pose"] as const;

export type TaskStatus =
  | "queued"
  | "running"
  | "storing"
  | "reviewing"
  | "succeeded"
  | "failed"
  | "refunded";

export const taskStatuses = ["queued", "running", "storing", "reviewing", "succeeded", "failed", "refunded"] as const;

export type AssetStatus = "succeeded" | "reviewing" | "processing" | "failed";

export const assetStatuses = ["succeeded", "reviewing", "processing", "failed"] as const;

export type AssetOrigin = "generated" | "uploaded";

export const assetOrigins = ["generated", "uploaded"] as const;

export type ImageProvider = "openai" | "agnes" | "custom";

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListImageTasksQuery extends PaginationQuery {
  taskType?: GenerationMode;
  status?: TaskStatus;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface ListImageAssetsQuery extends PaginationQuery {
  taskType?: GenerationMode;
  status?: AssetStatus;
  origin?: AssetOrigin;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface ImageGenerationTask {
  id: string;
  userId: string;
  taskType: GenerationMode;
  status: TaskStatus;
  prompt: string;
  negativePrompt?: string;
  requestPayload: Record<string, unknown>;
  modelProvider: ImageProvider | string;
  modelName: string;
  sourceAssetId?: string;
  chargedCredits: number;
  priority?: number;
  creditHoldId?: string;
  resultAssetIds: string[];
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImageAsset {
  id: string;
  userId: string;
  title: string;
  origin: AssetOrigin;
  taskId?: string;
  taskType?: GenerationMode;
  status: AssetStatus;
  prompt: string;
  imageUrl: string;
  objectKey: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  reviewStatus: "pending" | "approved" | "rejected" | "skipped";
  sourceAssetId?: string;
  downloadState: "not_downloaded" | "watermarked" | "hd";
  modelProvider: ImageProvider | string;
  modelName: string;
  entitlementSnapshot?: EntitlementSnapshot;
  deletedAt?: string;
  createdAt: string;
}

export interface AssetVersionNode {
  id: string;
  label: string;
  assetId: string;
}

export interface ImageAssetDetail {
  asset: ImageAsset;
  task?: ImageGenerationTask;
  versionNodes: AssetVersionNode[];
  downloadDecision: DownloadDecision;
  availableActions: Array<"download" | "image_to_image">;
}

export interface AccountEntitlement {
  userId: string;
  username?: string;
  displayName: string;
  credits: number;
  memberStatus: "free" | "credit_pack";
  preferredImageModelId?: string;
  canUseOutpaint: boolean;
  canDownloadHd: boolean;
  canDownloadWithoutWatermark: boolean;
}

export interface AccountCreditsSummary {
  userId: string;
  credits: number;
  estimatedStandardGenerations: number;
  groups?: Array<{
    label: string;
    amount: number;
    validUntil?: string;
  }>;
  recentChanges: Array<{
    id: string;
    label: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
  }>;
}

export interface CreateImageTaskInput {
  taskType: GenerationMode;
  prompt: string;
  negativePrompt?: string;
  sourceAssetId?: string;
  size?: string;
  count?: number;
  stylePreset?: string;
  strength?: number;
  structureMode?: StructureMode;
  selectedImageModelId?: string;
  modelProvider?: ImageProvider | string;
  modelName?: string;
}

export interface DownloadDecision {
  assetId: string;
  allowed: boolean;
  quality: "standard" | "hd";
  watermark: boolean;
  costCredits: number;
  reason: string;
  requiresPayment?: boolean;
  downloadUrl?: string;
}

export interface EntitlementSnapshot {
  memberStatus: AccountEntitlement["memberStatus"];
  capturedAt: string;
  canDownloadHd: boolean;
  canDownloadWithoutWatermark: boolean;
}
