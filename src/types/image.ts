export type GenerationMode = "t2i" | "i2i" | "inpaint" | "outpaint";

export const generationModes = ["t2i", "i2i", "inpaint", "outpaint"] as const;

export type TaskStatus =
  | "queued"
  | "processing"
  | "reviewing"
  | "succeeded"
  | "failed"
  | "insufficient_credits";

export const taskStatuses = ["queued", "processing", "reviewing", "succeeded", "failed", "insufficient_credits"] as const;

export type AssetStatus = "succeeded" | "reviewing" | "processing" | "failed" | "insufficient_credits";

export const assetStatuses = ["succeeded", "reviewing", "processing", "failed", "insufficient_credits"] as const;

export type ImageProvider = "openai" | "custom";

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
  resultAssetIds: string[];
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImageAsset {
  id: string;
  title: string;
  taskId: string;
  taskType: GenerationMode;
  status: AssetStatus;
  prompt: string;
  imageUrl: string;
  sourceAssetId?: string;
  downloadState: "not_downloaded" | "watermarked" | "hd";
  modelProvider: ImageProvider | string;
  modelName: string;
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
  availableActions: Array<"download" | "image_to_image" | "inpaint" | "outpaint">;
}

export interface AccountEntitlement {
  userId: string;
  displayName: string;
  credits: number;
  memberStatus: "free" | "points" | "pro_trial" | "pro";
  proDaysRemaining: number;
  canUseOutpaint: boolean;
  canDownloadHd: boolean;
  canDownloadWithoutWatermark: boolean;
}

export interface AccountCreditsSummary {
  userId: string;
  credits: number;
  estimatedStandardGenerations: number;
  recentChanges: Array<{
    id: string;
    label: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
  }>;
}

export interface AccountMembershipSummary {
  userId: string;
  memberStatus: AccountEntitlement["memberStatus"];
  proDaysRemaining: number;
  canUseOutpaint: boolean;
  canDownloadHd: boolean;
  canDownloadWithoutWatermark: boolean;
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
  downloadUrl?: string;
}
