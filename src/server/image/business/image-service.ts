import { createHash, randomUUID } from "node:crypto";
import type {
  AccountEntitlement,
  CreateImageTaskInput,
  DownloadDecision,
  ImageAsset,
  ImageAssetDetail,
  ImageGenerationTask,
  ListImageAssetsQuery,
  ListImageTasksQuery,
  PaginationMeta,
  StructureMode
} from "@/types/image";
import { pollImageGenerationResult, submitImageGeneration } from "@/server/image/ai/image-model-adapter";
import { getEnvImageModelConfig, listSelectableImageModels, resolveImageModelForTask } from "@/server/image/ai/model-config";
import { getRepositories } from "@/server/data/repositories";
import { CreditBalanceError, finalizeCreditHoldSpend, getAvailableCredits, refundCreditHold, releaseCreditHold, reserveCreditsForGeneration, settleCreditHoldPartially, spendCreditsForDownload } from "@/server/credits/credit-service";
import { createGeneratedAsset, storeGeneratedOutput, UploadValidationError, type StoredGeneratedOutput } from "@/server/image/storage/upload-service";
import { assertObjectReadable } from "@/server/storage/object-storage";
import { assertRunningTaskLimit, assertTaskCapability, assertTaskStateTransition, getTaskPriority } from "./task-policy";

const freeAssetRetentionDays = 7;
const freeAssetRetentionLimit = 20;
const outputReviewAspectRatioTolerance = 0.03;
const outputReviewDimensionTolerance = 0.08;

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

function relativeDifference(left: number, right: number) {
  return Math.abs(left - right) / Math.max(left, right);
}

function dimensionsAreCloseEnough(output: StoredGeneratedOutput, expectedWidth: number, expectedHeight: number) {
  const expectedAspectRatio = expectedWidth / expectedHeight;
  const outputAspectRatio = output.width / output.height;
  const minimumWidth = expectedWidth * (1 - outputReviewDimensionTolerance);
  const minimumHeight = expectedHeight * (1 - outputReviewDimensionTolerance);
  return relativeDifference(outputAspectRatio, expectedAspectRatio) <= outputReviewAspectRatioTolerance
    && output.width >= minimumWidth
    && output.height >= minimumHeight;
}

function includesText(value: string, q: string) {
  return value.toLowerCase().includes(q.toLowerCase());
}

function filterAssets(assets: ImageAsset[], query: ListImageAssetsQuery) {
  return assets.filter(asset => {
    if (query.taskType && asset.taskType !== query.taskType) return false;
    if (query.status && asset.status !== query.status) return false;
    if (query.origin && asset.origin !== query.origin) return false;
    if (query.q) {
      const searchable = [asset.id, asset.title, asset.prompt, asset.taskId || "", asset.origin, asset.modelProvider, asset.modelName].join(" ");
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

function applyVisibleAssetRetention(assets: ImageAsset[], account: AccountEntitlement, now = new Date()) {
  if (account.memberStatus !== "free") return assets;
  const cutoff = now.getTime() - freeAssetRetentionDays * 24 * 60 * 60 * 1000;
  return assets
    .filter(asset => Date.parse(asset.createdAt) >= cutoff)
    .slice(0, freeAssetRetentionLimit);
}

async function listVisibleAssetsForUser(userId: string) {
  const repositories = getRepositories();
  const [assets, account] = await Promise.all([
    repositories.image.listAssets({ userId }),
    repositories.account.getCurrentAccount(userId)
  ]);
  return applyVisibleAssetRetention(assets, account);
}

export async function listAssets(query: ListImageAssetsQuery = {}, userId?: string) {
  const repositories = getRepositories();
  const [assets, versionNodes] = await Promise.all([
    userId ? listVisibleAssetsForUser(userId) : repositories.image.listAssets({ userId }),
    repositories.image.listVersionNodes()
  ]);
  const filteredAssets = filterAssets(assets, query);
  const pagedAssets = paginate(filteredAssets, query);
  const visibleAssetIds = new Set(filteredAssets.map(asset => asset.id));
  return {
    assets: pagedAssets.items,
    versionNodes: versionNodes.filter(node => visibleAssetIds.has(node.assetId)),
    pagination: pagedAssets.pagination
  };
}

export async function getAsset(assetId: string, userId?: string) {
  if (!userId) {
    const asset = await getRepositories().image.getAsset(assetId);
    return asset?.deletedAt ? undefined : asset;
  }
  return (await listVisibleAssetsForUser(userId)).find(asset => asset.id === assetId);
}

export async function listTasks(query: ListImageTasksQuery = {}, userId?: string) {
  const tasks = await getRepositories().image.listTasks({ userId });
  const filteredTasks = filterTasks(tasks, query);
  const pagedTasks = paginate(filteredTasks, query);
  return { tasks: pagedTasks.items, pagination: pagedTasks.pagination };
}

export async function getTask(taskId: string, userId?: string) {
  const task = await getRepositories().image.getTask(taskId);
  if (!task || (userId && task.userId !== userId)) return undefined;
  return task;
}

export async function getAssetDetail(assetId: string, userId?: string): Promise<ImageAssetDetail | undefined> {
  const repositories = getRepositories();
  const asset = await getAsset(assetId, userId);

  if (!asset) return undefined;

  const [tasks, versionNodes, downloadDecision] = await Promise.all([
    repositories.image.listTasks({ userId }),
    repositories.image.listVersionNodes(),
    decideDownload(assetId, userId)
  ]);

  const task = tasks.find(item => item.id === asset.taskId || item.resultAssetIds.includes(asset.id));
  const actions: ImageAssetDetail["availableActions"] = asset.status === "succeeded"
    ? ["download", "image_to_image"]
    : [];

  return {
    asset,
    task,
    versionNodes: versionNodes.filter(node => node.assetId === asset.id),
    downloadDecision,
    availableActions: actions
  };
}

export async function createTask(input: CreateImageTaskInput, userId?: string): Promise<ImageGenerationTask> {
  const repositories = getRepositories();
  if (!userId) throw new Error("AUTH_REQUIRED");
  const accountBeforeHold = await getAvailableCredits(userId);
  assertTaskCapability(accountBeforeHold, input.taskType);
  const existingTasks = await repositories.image.listTasks({ userId });
  assertRunningTaskLimit(accountBeforeHold, existingTasks);

  const taskId = `TSK-${Date.now().toString(36).toUpperCase()}`;
  const { account, requiredCredits, hold } = await reserveCreditsForGeneration(userId, { taskId, taskType: input.taskType, count: input.count });
  const resolvedModel = await resolveImageModelForTask(account, input.selectedImageModelId);
  try {
    const now = new Date().toISOString();

    const task: ImageGenerationTask = {
      id: taskId,
      userId: account.userId,
      taskType: input.taskType,
      status: "queued",
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      requestPayload: {
        ...input,
        selectedImageModelId: resolvedModel.model.id,
        modelSelectionFallbackReason: resolvedModel.fallbackReason
      },
      modelProvider: resolvedModel.model.provider,
      modelName: resolvedModel.model.model,
      sourceAssetId: input.sourceAssetId,
      chargedCredits: requiredCredits,
      priority: getTaskPriority(account.memberStatus),
      creditHoldId: hold.id,
      resultAssetIds: [],
      createdAt: now,
      updatedAt: now
    };

    return repositories.image.createTask(task);
  } catch (error) {
    await releaseCreditHold(hold.id, "Generation Credit Hold Released");
    throw error;
  }
}

export async function transitionTaskState(taskId: string, nextStatus: ImageGenerationTask["status"], userId?: string, options: { errorCode?: string; errorMessage?: string } = {}) {
  const repositories = getRepositories();
  const task = await getTask(taskId, userId);
  if (!task) return undefined;

  assertTaskStateTransition(task.status, nextStatus);

  if (task.creditHoldId && nextStatus === "succeeded") {
    const hold = await repositories.credits.getHold(task.creditHoldId);
    if (hold?.status === "active") {
      await finalizeCreditHoldSpend(task.creditHoldId);
    }
  }

  if (task.creditHoldId && (nextStatus === "failed" || nextStatus === "refunded")) {
    const hold = await repositories.credits.getHold(task.creditHoldId);
    if (hold?.status === "active") {
      await releaseCreditHold(task.creditHoldId, nextStatus === "refunded" ? "Generation Credit Refunded" : "Generation Credit Hold Released");
    } else if (hold?.status === "spent") {
      await refundCreditHold(task.creditHoldId, "Generation Credit Refund");
    }
  }

  return repositories.image.updateTask(task.id, {
    status: nextStatus,
    errorCode: options.errorCode,
    errorMessage: options.errorMessage
  });
}

async function reviewStoredOutput(output: StoredGeneratedOutput, expectedSize?: string) {
  if (output.mimeType !== "image/png" && output.mimeType !== "image/jpeg" && output.mimeType !== "image/webp") {
    return { approved: false, reason: "output review rejected unsupported image format" };
  }
  if (output.width <= 0 || output.height <= 0) {
    return { approved: false, reason: "output review rejected unreadable image dimensions" };
  }
  try {
    await assertObjectReadable(output.objectKey);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "stored object could not be read";
    return { approved: false, reason: `output review rejected unreadable stored file: ${detail}` };
  }
  if (expectedSize) {
    const [expectedWidth, expectedHeight] = expectedSize.split("x").map(value => Number(value));
    if (expectedWidth && expectedHeight && !dimensionsAreCloseEnough(output, expectedWidth, expectedHeight)) {
      return { approved: false, reason: `output review rejected unexpected dimensions: expected ${expectedWidth}x${expectedHeight}, got ${output.width}x${output.height}` };
    }
  }
  if (output.sizeBytes < 128) {
    return { approved: false, reason: "output review rejected likely placeholder output" };
  }
  return { approved: true };
}

function outputBytesListFromSubmission(submission: { outputBytes?: Buffer; outputBytesList?: Buffer[] }) {
  return submission.outputBytesList?.length
    ? submission.outputBytesList
    : submission.outputBytes
      ? [submission.outputBytes]
      : [];
}

function requestPayloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function requestPayloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requestPayloadStructureMode(payload: Record<string, unknown>): StructureMode | undefined {
  const value = payload.structureMode;
  return value === "balanced" || value === "outline" || value === "pose" ? value : undefined;
}

async function modelConfigFromTaskSnapshot(task: ImageGenerationTask) {
  const fallback = getEnvImageModelConfig();
  const selectedImageModelId = requestPayloadString(task.requestPayload, "selectedImageModelId");
  const models = await listSelectableImageModels();
  const persistedModel = selectedImageModelId
    ? models.find(model => model.id === selectedImageModelId && model.provider === task.modelProvider && model.model === task.modelName)
    : undefined;
  const matchingModel = persistedModel || models.find(model => model.provider === task.modelProvider && model.model === task.modelName);
  const executionMode = requestPayloadString(task.requestPayload, "modelExecutionMode");
  return {
    provider: task.modelProvider,
    model: task.modelName,
    executionMode: matchingModel?.executionMode || (executionMode === "live" || executionMode === "mock" ? executionMode : fallback.executionMode),
    requestTimeoutMs: matchingModel?.requestTimeoutMs || requestPayloadNumber(task.requestPayload, "modelRequestTimeoutMs") || fallback.requestTimeoutMs,
    baseUrl: matchingModel?.baseUrl || requestPayloadString(task.requestPayload, "modelBaseUrl") || fallback.baseUrl,
    apiKeySecretRef: matchingModel?.apiKeySecretRef || requestPayloadString(task.requestPayload, "modelApiKeySecretRef") || fallback.apiKeySecretRef
  };
}

async function scheduleGeneratedOutputCleanup(taskId: string, objectKey: string) {
  const now = new Date().toISOString();
  return getRepositories().image.createAssetCleanupJob({
    id: `cleanup-${randomUUID()}`,
    assetId: taskId,
    objectKey,
    reason: "soft_deleted",
    scheduledAt: now,
    createdAt: now
  });
}

async function storeReviewAndFinalizeTask(task: ImageGenerationTask, submissionId: string, outputBytesList: Buffer[], userId?: string) {
  const repositories = getRepositories();
  await transitionTaskState(task.id, "storing", userId);
  await repositories.image.createProviderResult({
    id: `provider-result-${randomUUID()}`,
    submissionId,
    status: "succeeded",
    rawPayloadDigest: createHash("sha256").update(Buffer.concat(outputBytesList)).digest("hex"),
    outputMetadata: {
      outputCount: outputBytesList.length
    },
    createdAt: new Date().toISOString()
  });

  const outputs: StoredGeneratedOutput[] = [];
  const rejectedReasons: string[] = [];

  for (const outputBytes of outputBytesList) {
    try {
      outputs.push(await storeGeneratedOutput({
        task,
        bytes: outputBytes
      }));
    } catch (error) {
      const reason = error instanceof UploadValidationError
        ? `output review rejected invalid provider output: ${error.message}`
        : error instanceof Error
          ? `output review rejected unstorable provider output: ${error.message}`
          : "output review rejected unstorable provider output";
      rejectedReasons.push(reason);
    }
  }

  await transitionTaskState(task.id, "reviewing", userId);
  const expectedSize = typeof task.requestPayload.size === "string" ? task.requestPayload.size : undefined;

  const approvedOutputs: StoredGeneratedOutput[] = [];
  const rejectedOutputs = new Set<string>();
  for (const output of outputs) {
    const review = await reviewStoredOutput(output, expectedSize);
    if (!review.approved) {
      rejectedReasons.push(review.reason || "output review rejected provider output");
      rejectedOutputs.add(output.objectKey);
    } else {
      approvedOutputs.push(output);
    }
  }

  if (rejectedReasons.length > 0 && approvedOutputs.length === 0) {
    await Promise.all(outputs.map(output => scheduleGeneratedOutputCleanup(task.id, output.objectKey)));
    return transitionTaskState(task.id, "failed", userId, { errorCode: "OUTPUT_REJECTED", errorMessage: rejectedReasons[0] || "output review rejected provider output" });
  }

  const approvedAssetIds: string[] = [];
  for (const [index, output] of approvedOutputs.entries()) {
    const approvedAsset = await createGeneratedAsset({
      task,
      title: approvedOutputs.length > 1 ? `${task.prompt.slice(0, 44) || "Generated asset"} #${index + 1}` : task.prompt.slice(0, 48) || "Generated asset",
      output,
      reviewStatus: "approved"
    });
    approvedAssetIds.push(approvedAsset.id);
  }

  if (rejectedReasons.length > 0) {
    await Promise.all(outputs.filter(output => rejectedOutputs.has(output.objectKey)).map(output => scheduleGeneratedOutputCleanup(task.id, output.objectKey)));
    if (task.creditHoldId) {
      const spendAmount = Math.ceil(task.chargedCredits * (approvedOutputs.length / outputBytesList.length));
      await settleCreditHoldPartially(task.creditHoldId, spendAmount);
    }
  }

  await repositories.image.updateTask(task.id, { resultAssetIds: approvedAssetIds });
  return transitionTaskState(task.id, "succeeded", userId);
}

async function continueAsyncImageTask(task: ImageGenerationTask, userId?: string) {
  const providerSubmissionId = typeof task.requestPayload.providerSubmissionId === "string" ? task.requestPayload.providerSubmissionId : undefined;
  const externalTaskId = typeof task.requestPayload.externalTaskId === "string" ? task.requestPayload.externalTaskId : undefined;
  if (!providerSubmissionId || !externalTaskId) return task;
  const modelConfig = await modelConfigFromTaskSnapshot(task);
  const lastRunnerUpdate = Date.parse(task.updatedAt || task.createdAt);
  if (Number.isFinite(lastRunnerUpdate) && Date.now() - lastRunnerUpdate > modelConfig.requestTimeoutMs) {
    return transitionTaskState(task.id, "failed", userId, {
      errorCode: "TASK_RUNNER_TIMEOUT",
      errorMessage: `${task.modelProvider} async image result timed out after ${modelConfig.requestTimeoutMs}ms`
    });
  }

  const submission = await pollImageGenerationResult({
    provider: String(task.modelProvider),
    modelName: task.modelName,
    externalTaskId,
    modelConfig
  });
  const outputBytesList = outputBytesListFromSubmission(submission);
  if (submission.providerMode !== "sync" || outputBytesList.length === 0) return task;

  return storeReviewAndFinalizeTask(task, providerSubmissionId, outputBytesList, userId);
}

export async function runImageTask(taskId: string, userId?: string) {
  const repositories = getRepositories();
  const task = await getTask(taskId, userId);
  if (!task) return undefined;

  try {
    if (task.status === "running" && task.requestPayload.providerMode === "async") {
      return continueAsyncImageTask(task, userId);
    }
    if (task.status !== "queued") return task;

    const claimedTask = await repositories.image.claimQueuedTask(task.id);
    if (!claimedTask) return getTask(task.id, userId);

    const sourceAsset = claimedTask.sourceAssetId ? await getAsset(claimedTask.sourceAssetId, userId) : undefined;
    const submission = await submitImageGeneration({
      taskType: claimedTask.taskType,
      prompt: claimedTask.prompt,
      negativePrompt: claimedTask.negativePrompt,
      sourceAssetId: claimedTask.sourceAssetId,
      sourceImageUrl: sourceAsset?.publicUrl || sourceAsset?.imageUrl,
      size: requestPayloadString(claimedTask.requestPayload, "size") || "1024x1024",
      count: requestPayloadNumber(claimedTask.requestPayload, "count") || 1,
      stylePreset: requestPayloadString(claimedTask.requestPayload, "stylePreset"),
      strength: requestPayloadNumber(claimedTask.requestPayload, "strength"),
      structureMode: requestPayloadStructureMode(claimedTask.requestPayload),
      modelConfig: await modelConfigFromTaskSnapshot(claimedTask)
    });
    const submissionId = `submission-${claimedTask.id}`;
    await repositories.image.createProviderSubmission({
      id: submissionId,
      taskId: claimedTask.id,
      provider: submission.provider,
      modelName: submission.modelName,
      providerMode: submission.providerMode,
      requestMetadata: {
        externalTaskId: submission.externalTaskId,
        estimatedDurationMs: submission.estimatedDurationMs,
        hasSynchronousOutput: Boolean(submission.outputBytesList?.length || submission.outputBytes),
        outputCount: submission.outputBytesList?.length || (submission.outputBytes ? 1 : 0),
        taskType: claimedTask.taskType,
        size: typeof claimedTask.requestPayload.size === "string" ? claimedTask.requestPayload.size : "1024x1024"
      },
      externalTaskId: submission.externalTaskId,
      createdAt: new Date().toISOString()
    });
    const taskWithSubmission = await repositories.image.updateTask(claimedTask.id, {
      requestPayload: {
        ...claimedTask.requestPayload,
        externalTaskId: submission.externalTaskId,
        providerMode: submission.providerMode,
        providerSubmissionId: submissionId
      }
    });
    const runnableTask = taskWithSubmission || claimedTask;

    const outputBytesList = outputBytesListFromSubmission(submission);
    if (submission.providerMode !== "sync" || outputBytesList.length === 0) {
      const externalTaskId = String(submission.externalTaskId || claimedTask.id);
      await repositories.image.createProviderResult({
        id: `provider-result-${randomUUID()}`,
        submissionId,
        status: "pending",
        rawPayloadDigest: createHash("sha256").update(externalTaskId).digest("hex"),
        outputMetadata: {
          externalTaskId,
          providerMode: submission.providerMode
        },
        createdAt: new Date().toISOString()
      });
      return getTask(claimedTask.id, userId);
    }

    return storeReviewAndFinalizeTask(runnableTask, submissionId, outputBytesList, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "task runner failed";
    return transitionTaskState(task.id, "failed", userId, { errorCode: "TASK_RUNNER_FAILED", errorMessage: message });
  }
}

export async function deleteAsset(assetId: string, userId: string) {
  const repositories = getRepositories();
  const asset = await getAsset(assetId, userId);
  if (!asset) return undefined;

  const deletedAt = new Date().toISOString();
  const deleted = await repositories.image.softDeleteAsset(asset.id, deletedAt);
  if (!deleted) return undefined;

  await repositories.image.createAssetCleanupJob({
    id: `cleanup-${randomUUID()}`,
    assetId: asset.id,
    objectKey: asset.objectKey,
    reason: "soft_deleted",
    scheduledAt: deletedAt,
    createdAt: deletedAt
  });

  return deleted;
}

const hdNoWatermarkDownloadCost = 5;

export async function decideDownload(assetId: string, userId?: string): Promise<DownloadDecision> {
  const repositories = getRepositories();
  const [asset, account] = await Promise.all([
    getAsset(assetId, userId),
    repositories.account.getCurrentAccount(userId)
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

  if (asset.downloadState === "hd") {
    return {
      assetId,
      allowed: true,
      quality: "hd",
      watermark: false,
      costCredits: 0,
      reason: "该图片已解锁高清无水印下载",
      downloadUrl: asset.imageUrl
    };
  }

  if (account.credits < hdNoWatermarkDownloadCost) {
    return {
      assetId,
      allowed: false,
      quality: "hd",
      watermark: false,
      costCredits: hdNoWatermarkDownloadCost,
      reason: "高清无水印下载需要 5 credits，当前余额不足",
      requiresPayment: true
    };
  }

  return {
    assetId,
    allowed: true,
    quality: "hd",
    watermark: false,
    costCredits: hdNoWatermarkDownloadCost,
    reason: "高清无水印下载扣 5 credits",
    requiresPayment: true,
    downloadUrl: asset.imageUrl
  };
}

export async function confirmDownload(assetId: string, userId: string): Promise<DownloadDecision> {
  const repositories = getRepositories();
  const decision = await decideDownload(assetId, userId);
  if (!decision.allowed) return decision;

  const now = new Date().toISOString();

  try {
    if (decision.costCredits > 0) {
      const download = await repositories.billing.createDownloadEvent({
        id: `download-${randomUUID()}`,
        assetId,
        userId,
        downloadType: "hd_no_watermark",
        creditCost: decision.costCredits,
        createdAt: now
      });
      await spendCreditsForDownload(userId, { downloadId: download.id, amount: decision.costCredits });
    }
    await repositories.image.updateAsset(assetId, { downloadState: "hd" });
    return decision;
  } catch (error) {
    if (error instanceof CreditBalanceError || (error instanceof Error && error.message === "INSUFFICIENT_CREDITS")) {
      return {
        ...decision,
        allowed: false,
        requiresPayment: true,
        reason: "高清无水印下载需要 5 credits，当前余额不足"
      };
    }
    throw error;
  }
}
