import type { ImageProvider } from "@/types/image";
import { getRepositories } from "@/server/data/repositories";
import type { AccountEntitlement } from "@/types/image";
import type { SelectableImageModel } from "@/types/model-config";

export interface ImageModelConfig {
  provider: ImageProvider | string;
  model: string;
  baseUrl?: string;
  apiKeySecretRef?: string;
  executionMode: "mock" | "live";
  requestTimeoutMs: number;
}

export interface UserModelSelectionState {
  eligible: boolean;
  defaultModel: UserSafeSelectableImageModel;
  models: Array<Pick<SelectableImageModel, "id" | "displayName" | "provider" | "model" | "enabled" | "isDefault">>;
  preferredImageModelId?: string;
  selectedImageModelId: string;
  fallbackReason?: "not_eligible" | "missing_preference" | "unavailable_preference" | "unavailable_selection";
}

type UserSafeSelectableImageModel = Pick<SelectableImageModel, "id" | "displayName" | "provider" | "model" | "enabled" | "isDefault">;

function envRequestTimeoutMs() {
  const configured = Number(process.env.IMAGE_MODEL_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 120000;
}

export function getEnvImageModelConfig(): ImageModelConfig {
  return {
    provider: process.env.IMAGE_MODEL_PROVIDER || "agnes",
    model: process.env.IMAGE_MODEL_NAME || process.env.OPENAI_IMAGE_MODEL || "agnes-image-2.1-flash",
    baseUrl: process.env.IMAGE_MODEL_BASE_URL || "https://apihub.agnes-ai.com/v1",
    apiKeySecretRef: process.env.IMAGE_MODEL_API_KEY_SECRET_REF || "FLUXART_IMAGE_API_KEY",
    executionMode: process.env.IMAGE_MODEL_EXECUTION === "live" ? "live" : "mock",
    requestTimeoutMs: envRequestTimeoutMs()
  };
}

export async function getImageModelConfig(): Promise<ImageModelConfig> {
  const active = await getRepositories().modelConfig.getActiveConfiguration();
  if (!active) return getEnvImageModelConfig();
  return {
    provider: active.provider,
    model: active.model,
    baseUrl: active.baseUrl,
    apiKeySecretRef: active.apiKeySecretRef,
    executionMode: active.executionMode,
    requestTimeoutMs: active.requestTimeoutMs
  };
}

function envDefaultSelectableModel(): SelectableImageModel {
  const envConfig = getEnvImageModelConfig();
  const now = new Date().toISOString();
  return {
    id: "active",
    displayName: "Default Image Model",
    provider: envConfig.provider,
    model: envConfig.model,
    baseUrl: envConfig.baseUrl || "https://apihub.agnes-ai.com/v1",
    apiKeySecretRef: envConfig.apiKeySecretRef || "FLUXART_IMAGE_API_KEY",
    executionMode: envConfig.executionMode,
    requestTimeoutMs: envConfig.requestTimeoutMs,
    enabled: true,
    isDefault: true,
    lastTestStatus: "untested",
    createdAt: now,
    updatedAt: now
  };
}

export async function listSelectableImageModels() {
  const models = await getRepositories().modelConfig.listConfigurations();
  return models.length ? models : [envDefaultSelectableModel()];
}

function toModelConfig(model: SelectableImageModel): ImageModelConfig {
  return {
    provider: model.provider,
    model: model.model,
    baseUrl: model.baseUrl,
    apiKeySecretRef: model.apiKeySecretRef,
    executionMode: model.executionMode,
    requestTimeoutMs: model.requestTimeoutMs
  };
}

function toUserSafeModel(model: SelectableImageModel): UserSafeSelectableImageModel {
  const { id, displayName, provider, model: modelName, enabled, isDefault } = model;
  return { id, displayName, provider, model: modelName, enabled, isDefault };
}

export async function getUserModelSelectionState(account: Pick<AccountEntitlement, "memberStatus" | "preferredImageModelId">, selectedImageModelId?: string): Promise<UserModelSelectionState> {
  const models = await listSelectableImageModels();
  const enabledModels = models.filter(model => model.enabled);
  const defaultModel = enabledModels.find(model => model.isDefault) || enabledModels[0] || models[0] || envDefaultSelectableModel();
  const eligible = account.memberStatus === "credit_pack";

  let selected = defaultModel;
  let fallbackReason: UserModelSelectionState["fallbackReason"];
  if (!eligible) {
    fallbackReason = "not_eligible";
  } else {
    const requested = selectedImageModelId ? enabledModels.find(model => model.id === selectedImageModelId) : undefined;
    const preferred = account.preferredImageModelId ? enabledModels.find(model => model.id === account.preferredImageModelId) : undefined;
    selected = requested || preferred || defaultModel;
    if (selectedImageModelId && !requested) fallbackReason = "unavailable_selection";
    else if (account.preferredImageModelId && !preferred) fallbackReason = "unavailable_preference";
    else if (!selectedImageModelId && !account.preferredImageModelId) fallbackReason = "missing_preference";
  }

  return {
    eligible,
    defaultModel: toUserSafeModel(defaultModel),
    models: eligible
      ? enabledModels.map(toUserSafeModel)
      : [toUserSafeModel(defaultModel)],
    preferredImageModelId: eligible ? account.preferredImageModelId : undefined,
    selectedImageModelId: selected.id,
    fallbackReason
  };
}

export async function resolveImageModelForTask(account: Pick<AccountEntitlement, "memberStatus" | "preferredImageModelId">, selectedImageModelId?: string) {
  const models = await listSelectableImageModels();
  const enabledModels = models.filter(model => model.enabled);
  const defaultModel = enabledModels.find(model => model.isDefault) || enabledModels[0] || models[0] || envDefaultSelectableModel();
  if (account.memberStatus !== "credit_pack") {
    return { model: defaultModel, config: toModelConfig(defaultModel), fallbackReason: "not_eligible" as const };
  }
  const requested = selectedImageModelId ? enabledModels.find(model => model.id === selectedImageModelId) : undefined;
  const preferred = account.preferredImageModelId ? enabledModels.find(model => model.id === account.preferredImageModelId) : undefined;
  const model = requested || preferred || defaultModel;
  const fallbackReason = selectedImageModelId && !requested
    ? "unavailable_selection"
    : account.preferredImageModelId && !preferred
      ? "unavailable_preference"
      : undefined;
  return { model, config: toModelConfig(model), fallbackReason };
}
