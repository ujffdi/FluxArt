import type {
  CreateImageTaskInput,
  DownloadDecision,
  ImageAsset,
  ImageAssetDetail,
  ImageGenerationTask,
  ListImageAssetsQuery,
  ListImageTasksQuery,
  PaginationMeta
} from "@/types/image";
import { submitImageGeneration } from "@/server/image/ai/image-model-adapter";
import { getRepositories } from "@/server/data/repositories";

function paginate<T>(items: T[], query: { page?: number; pageSize?: number }) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pagination: PaginationMeta = { page, pageSize, total, totalPages };

  return {
    items: items.slice(start, start + pageSize),
    pagination
  };
}

function includesText(value: string, q: string) {
  return value.toLowerCase().includes(q.toLowerCase());
}

function filterAssets(assets: ImageAsset[], query: ListImageAssetsQuery) {
  return assets.filter(asset => {
    if (query.taskType && asset.taskType !== query.taskType) return false;
    if (query.status && asset.status !== query.status) return false;
    if (query.q) {
      const searchable = [asset.id, asset.title, asset.prompt, asset.taskId, asset.modelProvider, asset.modelName].join(" ");
      if (!includesText(searchable, query.q)) return false;
    }
    return true;
  });
}

function filterTasks(tasks: ImageGenerationTask[], query: ListImageTasksQuery) {
  return tasks.filter(task => {
    if (query.taskType && task.taskType !== query.taskType) return false;
    if (query.status && task.status !== query.status) return false;
    if (query.q) {
      const searchable = [task.id, task.prompt, task.negativePrompt || "", task.modelProvider, task.modelName].join(" ");
      if (!includesText(searchable, query.q)) return false;
    }
    return true;
  });
}

export async function listAssets(query: ListImageAssetsQuery = {}) {
  const repositories = getRepositories();
  const [assets, versionNodes] = await Promise.all([
    repositories.image.listAssets(),
    repositories.image.listVersionNodes()
  ]);
  const filteredAssets = filterAssets(assets, query);
  const pagedAssets = paginate(filteredAssets, query);
  return { assets: pagedAssets.items, versionNodes, pagination: pagedAssets.pagination };
}

export async function getAsset(assetId: string) {
  return getRepositories().image.getAsset(assetId);
}

export async function listTasks(query: ListImageTasksQuery = {}) {
  const tasks = await getRepositories().image.listTasks();
  const filteredTasks = filterTasks(tasks, query);
  const pagedTasks = paginate(filteredTasks, query);
  return { tasks: pagedTasks.items, pagination: pagedTasks.pagination };
}

export async function getTask(taskId: string) {
  return getRepositories().image.getTask(taskId);
}

export async function getAssetDetail(assetId: string): Promise<ImageAssetDetail | undefined> {
  const repositories = getRepositories();
  const [asset, tasks, versionNodes, downloadDecision] = await Promise.all([
    repositories.image.getAsset(assetId),
    repositories.image.listTasks(),
    repositories.image.listVersionNodes(),
    decideDownload(assetId)
  ]);

  if (!asset) return undefined;

  const task = tasks.find(item => item.id === asset.taskId || item.resultAssetIds.includes(asset.id));
  const actions: ImageAssetDetail["availableActions"] = asset.status === "succeeded"
    ? ["download", "image_to_image", "inpaint", "outpaint"]
    : [];

  return {
    asset,
    task,
    versionNodes: versionNodes.filter(node => node.assetId === asset.id),
    downloadDecision,
    availableActions: actions
  };
}

export async function createTask(input: CreateImageTaskInput): Promise<ImageGenerationTask> {
  const repositories = getRepositories();
  const account = await repositories.account.getCurrentAccount();
  const submission = await submitImageGeneration(input);
  const chargedCredits = input.taskType === "outpaint" ? 36 : input.taskType === "i2i" ? 32 : 18;
  const now = new Date().toISOString();

  const task: ImageGenerationTask = {
    id: `TSK-${Date.now().toString(36).toUpperCase()}`,
    userId: account.userId,
    taskType: input.taskType,
    status: "queued",
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    requestPayload: {
      ...input,
      externalTaskId: submission.externalTaskId,
      estimatedDurationMs: submission.estimatedDurationMs
    },
    modelProvider: submission.provider,
    modelName: submission.modelName,
    sourceAssetId: input.sourceAssetId,
    chargedCredits,
    resultAssetIds: [],
    createdAt: now,
    updatedAt: now
  };

  return repositories.image.createTask(task);
}

export async function decideDownload(assetId: string): Promise<DownloadDecision> {
  const repositories = getRepositories();
  const [asset, account] = await Promise.all([
    repositories.image.getAsset(assetId),
    repositories.account.getCurrentAccount()
  ]);

  if (!asset) {
    return {
      assetId,
      allowed: false,
      quality: "standard",
      watermark: true,
      costCredits: 0,
      reason: "图片资产不存在"
    };
  }

  if (asset.status !== "succeeded") {
    return {
      assetId,
      allowed: false,
      quality: "standard",
      watermark: true,
      costCredits: 0,
      reason: "图片未生成成功，暂不可下载"
    };
  }

  if (account.canDownloadHd && account.canDownloadWithoutWatermark) {
    return {
      assetId,
      allowed: true,
      quality: "hd",
      watermark: false,
      costCredits: 0,
      reason: "Pro 试用权益满足，可下载高清无水印版本",
      downloadUrl: asset.imageUrl
    };
  }

  return {
    assetId,
    allowed: true,
    quality: "standard",
    watermark: true,
    costCredits: 0,
    reason: "免费权益仅支持带水印标清下载",
    downloadUrl: asset.imageUrl
  };
}
