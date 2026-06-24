import type { AccountEntitlement, AssetVersionNode, ImageAsset, ImageGenerationTask } from "@/types/image";

export const account: AccountEntitlement = {
  userId: "usr_flux_001",
  displayName: "林澈",
  credits: 1280,
  memberStatus: "pro_trial",
  proDaysRemaining: 5,
  canUseOutpaint: true,
  canDownloadHd: true,
  canDownloadWithoutWatermark: true
};

export const assets: ImageAsset[] = [
  {
    id: "IMG-1832",
    title: "香薰产品主图",
    taskId: "T2I-240618-0912",
    taskType: "t2i",
    status: "succeeded",
    prompt: "暗色背景商业摄影，现代香薰产品，柔和边缘光",
    imageUrl: "/flux-art-reference.png",
    downloadState: "hd",
    modelProvider: "openai",
    modelName: "gpt-image-2",
    createdAt: "今天 10:24"
  },
  {
    id: "IMG-1890",
    title: "咖啡机海报变体",
    taskId: "I2I-240618-0936",
    taskType: "i2i",
    status: "reviewing",
    prompt: "保持产品结构，改成咖啡机商业海报氛围",
    imageUrl: "/flux-art-reference.png",
    sourceAssetId: "IMG-1832",
    downloadState: "not_downloaded",
    modelProvider: "openai",
    modelName: "gpt-image-2",
    createdAt: "今天 10:36"
  },
  {
    id: "IMG-1944",
    title: "背景局部重绘",
    taskId: "INP-240618-1011",
    taskType: "inpaint",
    status: "succeeded",
    prompt: "将左侧背景替换为深色岩石台面",
    imageUrl: "/flux-art-reference.png",
    sourceAssetId: "IMG-1832",
    downloadState: "watermarked",
    modelProvider: "openai",
    modelName: "gpt-image-2",
    createdAt: "今天 10:11"
  },
  {
    id: "IMG-2012",
    title: "横版扩图任务",
    taskId: "OUT-240618-1030",
    taskType: "outpaint",
    status: "insufficient_credits",
    prompt: "向左右延展摄影棚背景",
    imageUrl: "/flux-art-reference.png",
    sourceAssetId: "IMG-1832",
    downloadState: "not_downloaded",
    modelProvider: "custom",
    modelName: "studio-outpaint-v1",
    createdAt: "今天 10:30"
  },
  {
    id: "IMG-2048",
    title: "电商详情页氛围图",
    taskId: "T2I-240618-1042",
    taskType: "t2i",
    status: "succeeded",
    prompt: "用于详情页的柔光产品氛围图",
    imageUrl: "/flux-art-reference.png",
    downloadState: "not_downloaded",
    modelProvider: "openai",
    modelName: "gpt-image-2",
    createdAt: "今天 10:42"
  },
  {
    id: "IMG-2088",
    title: "办公空间扩展",
    taskId: "OUT-240618-1105",
    taskType: "outpaint",
    status: "processing",
    prompt: "扩展办公空间和窗外自然光",
    imageUrl: "/flux-art-reference.png",
    sourceAssetId: "IMG-2048",
    downloadState: "not_downloaded",
    modelProvider: "openai",
    modelName: "gpt-image-2",
    createdAt: "今天 11:05"
  }
];

export const tasks: ImageGenerationTask[] = [
  {
    id: "TSK-240618-0912",
    userId: account.userId,
    taskType: "t2i",
    status: "queued",
    prompt: "一张用于电商主图的现代香薰产品摄影",
    negativePrompt: "低清晰度、畸变、文字水印",
    requestPayload: { size: "1024x1024", count: 4 },
    modelProvider: "openai",
    modelName: "gpt-image-2",
    chargedCredits: 18,
    resultAssetIds: ["IMG-1832"],
    createdAt: "今天 10:24",
    updatedAt: "今天 10:24"
  },
  {
    id: "TSK-240618-1105",
    userId: account.userId,
    taskType: "outpaint",
    status: "processing",
    prompt: "保持同一摄影棚光线，延展背景材质和阴影",
    requestPayload: { direction: "left-right", ratio: "1.5x" },
    modelProvider: "openai",
    modelName: "gpt-image-2",
    sourceAssetId: "IMG-2048",
    chargedCredits: 36,
    resultAssetIds: ["IMG-2088"],
    durationMs: 18000,
    createdAt: "今天 11:05",
    updatedAt: "刚刚"
  }
];

export const versionNodes: AssetVersionNode[] = [
  { id: "v1", label: "原始 Prompt：暗色背景商业摄影", assetId: "IMG-1832" },
  { id: "v2", label: "局部重绘 V2：替换背景材质", assetId: "IMG-1944" },
  { id: "v3", label: "扩图 V3：横版营销素材", assetId: "IMG-2012" }
];
