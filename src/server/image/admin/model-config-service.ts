import { getRepositories } from "@/server/data/repositories";
import { getEnvImageModelConfig } from "@/server/image/ai/model-config";
import { isEncryptedSecretRef, liveSecretRefProblem, normalizeSecretRef, redactSecretValues, resolveApiKeySecret } from "@/server/image/ai/secret-ref";
import type { ActiveImageModelConfigurationRecord } from "@/server/data/records";
import type { EditableImageModelConfiguration, EditableSelectableImageModel, ModelConfigurationChange, ModelConfigurationTestStatus } from "@/types/model-config";

export class ModelConfigurationError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = "ModelConfigurationError";
  }
}

export const modelConfigurationPresets = [
  {
    id: "agnes-image-2.1-flash",
    label: "Agnes Image 2.1 Flash",
    config: {
      id: "agnes-image-2-1-flash",
      displayName: "Agnes Image 2.1 Flash",
      provider: "agnes",
      model: "agnes-image-2.1-flash",
      baseUrl: "https://apihub.agnes-ai.com/v1",
      apiKeySecretRef: "FLUXART_IMAGE_API_KEY",
      executionMode: "mock",
      requestTimeoutMs: 120000,
      enabled: true,
      isDefault: true
    } satisfies EditableSelectableImageModel
  },
  {
    id: "openai-compatible",
    label: "OpenAI compatible",
    config: {
      id: "openai-compatible",
      displayName: "OpenAI compatible",
      provider: "openai",
      model: "gpt-image-2",
      baseUrl: "https://api.openai.com/v1",
      apiKeySecretRef: "OPENAI_API_KEY",
      executionMode: "mock",
      requestTimeoutMs: 120000,
      enabled: true,
      isDefault: false
    } satisfies EditableSelectableImageModel
  },
  {
    id: "custom-compatible",
    label: "Custom compatible",
    config: {
      id: "custom-compatible",
      displayName: "Custom compatible",
      provider: "custom",
      model: "custom-image-model",
      baseUrl: "https://provider.example.com/v1",
      apiKeySecretRef: "CUSTOM_PROVIDER_API_KEY",
      executionMode: "mock",
      requestTimeoutMs: 120000,
      enabled: false,
      isDefault: false
    } satisfies EditableSelectableImageModel
  }
];

const supportedProviders = new Set(["agnes", "openai", "custom"]);
const secretRefMaxLength = 2048;
const configuredSecretPlaceholder = "__FLUXART_CONFIGURED_MODEL_API_KEY__";

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function errorSummary(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecretValues(message).slice(0, 512);
}

export function validateModelConfiguration(input: unknown): EditableImageModelConfiguration {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const provider = trimString(record.provider);
  const model = trimString(record.model);
  const baseUrl = trimString(record.baseUrl).replace(/\/+$/, "");
  let apiKeySecretRef = trimString(record.apiKeySecretRef);
  const executionMode = record.executionMode === "live" ? "live" : record.executionMode === "mock" ? "mock" : undefined;
  const requestTimeoutMs = Number(record.requestTimeoutMs);

  if (!supportedProviders.has(provider)) {
    throw new ModelConfigurationError("provider must be agnes, openai, or custom", "MODEL_PROVIDER_UNSUPPORTED");
  }
  if (!model || model.length > 120) {
    throw new ModelConfigurationError("model is required and must be 120 characters or fewer", "MODEL_NAME_INVALID");
  }
  if (!baseUrl || baseUrl.length > 512 || !validUrl(baseUrl)) {
    throw new ModelConfigurationError("baseUrl must be a valid http or https URL", "MODEL_BASE_URL_INVALID");
  }
  if (!apiKeySecretRef) {
    throw new ModelConfigurationError(`apiKeySecretRef must be 1-${secretRefMaxLength} characters`, "MODEL_SECRET_REF_INVALID");
  }
  apiKeySecretRef = normalizeSecretRef(apiKeySecretRef);
  if (apiKeySecretRef.length > secretRefMaxLength) {
    throw new ModelConfigurationError(`apiKeySecretRef must be 1-${secretRefMaxLength} characters`, "MODEL_SECRET_REF_INVALID");
  }
  if (!executionMode) {
    throw new ModelConfigurationError("executionMode must be mock or live", "MODEL_EXECUTION_INVALID");
  }
  const secretRefProblem = executionMode === "live" ? liveSecretRefProblem(apiKeySecretRef) : undefined;
  if (secretRefProblem) {
    throw new ModelConfigurationError(secretRefProblem, "MODEL_SECRET_REF_INVALID");
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 1800000) {
    throw new ModelConfigurationError("requestTimeoutMs must be an integer from 1000 to 1800000", "MODEL_TIMEOUT_INVALID");
  }

  return { provider, model, baseUrl, apiKeySecretRef, executionMode, requestTimeoutMs };
}

function slugId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function rawModelItems(input: unknown) {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  return Array.isArray(input) ? input : Array.isArray(record.models) ? record.models : [input];
}

function resolveConfiguredSecretPlaceholders(input: unknown, existing: ActiveImageModelConfigurationRecord[]) {
  const existingById = new Map(existing.map(model => [model.id, model.apiKeySecretRef]));
  return rawModelItems(input).map((raw, index) => {
    const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    if (trimString(item.apiKeySecretRef) !== configuredSecretPlaceholder) return raw;
    const id = slugId(trimString(item.id) || trimString(item.displayName) || trimString(item.model)) || `model-${index + 1}`;
    const existingSecretRef = existingById.get(id);
    if (!existingSecretRef) {
      throw new ModelConfigurationError("输入新的 API Key 后再保存此模型配置", "MODEL_SECRET_REQUIRED");
    }
    return { ...item, apiKeySecretRef: existingSecretRef };
  });
}

export function validateSelectableImageModels(input: unknown): EditableSelectableImageModel[] {
  const rawModels = rawModelItems(input);
  const models = rawModels.map((raw, index) => {
    const item = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const config = validateModelConfiguration(item);
    const displayName = trimString(item.displayName) || config.model;
    const id = slugId(trimString(item.id) || displayName || config.model) || `model-${index + 1}`;
    return {
      id,
      displayName,
      ...config,
      enabled: item.enabled !== false,
      isDefault: item.isDefault === true
    };
  });

  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) {
      throw new ModelConfigurationError("model ids must be unique", "MODEL_ID_DUPLICATE");
    }
    ids.add(model.id);
  }

  const enabled = models.filter(model => model.enabled);
  if (!enabled.length) {
    throw new ModelConfigurationError("at least one model must be enabled", "MODEL_ENABLED_REQUIRED");
  }
  const defaults = models.filter(model => model.isDefault);
  if (defaults.length !== 1) {
    throw new ModelConfigurationError("exactly one default model is required", "MODEL_DEFAULT_REQUIRED");
  }
  if (!defaults[0].enabled) {
    throw new ModelConfigurationError("default model must be enabled", "MODEL_DEFAULT_DISABLED");
  }
  return models;
}

function activeFromEnv(): ActiveImageModelConfigurationRecord {
  const envConfig = getEnvImageModelConfig();
  const now = new Date().toISOString();
  return {
    id: "active",
    displayName: "Default Image Model",
    provider: String(envConfig.provider),
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

function editableFromActive(config: ActiveImageModelConfigurationRecord): EditableImageModelConfiguration {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKeySecretRef: config.apiKeySecretRef,
    executionMode: config.executionMode,
    requestTimeoutMs: config.requestTimeoutMs
  };
}

function sameEditableConfig(left: EditableImageModelConfiguration, right: EditableImageModelConfiguration) {
  return left.provider === right.provider
    && left.model === right.model
    && left.baseUrl === right.baseUrl
    && left.apiKeySecretRef === right.apiKeySecretRef
    && left.executionMode === right.executionMode
    && left.requestTimeoutMs === right.requestTimeoutMs;
}

function sameSelectableModel(left: EditableSelectableImageModel, right: EditableSelectableImageModel) {
  return left.id === right.id
    && left.displayName === right.displayName
    && left.enabled === right.enabled
    && left.isDefault === right.isDefault
    && sameEditableConfig(left, right);
}

function editableFromActiveModel(config: ActiveImageModelConfigurationRecord): EditableSelectableImageModel {
  return {
    id: config.id,
    displayName: config.displayName,
    ...editableFromActive(config),
    enabled: config.enabled,
    isDefault: config.isDefault
  };
}

function sameSelectableModelList(left: EditableSelectableImageModel[], right: EditableSelectableImageModel[]) {
  if (left.length !== right.length) return false;
  return left
    .map(model => model.id)
    .sort()
    .every((id, index, sortedIds) => {
      if (index > 0 && id === sortedIds[index - 1]) return false;
      const leftModel = left.find(model => model.id === id);
      const rightModel = right.find(model => model.id === id);
      return !!leftModel && !!rightModel && sameSelectableModel(leftModel, rightModel);
    });
}

function adminSafeEditableModel(model: EditableSelectableImageModel): EditableSelectableImageModel {
  return {
    ...model,
    apiKeySecretRef: isEncryptedSecretRef(model.apiKeySecretRef) ? configuredSecretPlaceholder : model.apiKeySecretRef
  };
}

function adminSafeActiveModel(model: ActiveImageModelConfigurationRecord): ActiveImageModelConfigurationRecord {
  return {
    ...model,
    apiKeySecretRef: isEncryptedSecretRef(model.apiKeySecretRef) ? configuredSecretPlaceholder : model.apiKeySecretRef
  };
}

function adminSafeChange<T extends ModelConfigurationChange>(change: T): T {
  return {
    ...change,
    beforeConfig: change.beforeConfig?.map(adminSafeEditableModel),
    afterConfig: change.afterConfig.map(adminSafeEditableModel)
  };
}

export async function getModelAdministrationState() {
  const repositories = getRepositories();
  const configured = await repositories.modelConfig.listConfigurations();
  const fallback = activeFromEnv();
  const configurations = configured.length ? configured : [fallback];
  const active = configurations.find(model => model.enabled && model.isDefault) || configurations[0];
  const changes = await repositories.modelConfig.listConfigurationChanges(10);
  return {
    configuration: adminSafeActiveModel(active),
    configurations: configurations.map(adminSafeActiveModel),
    configurationSource: configured.length ? "data" : "env",
    changes: changes.map(adminSafeChange),
    presets: modelConfigurationPresets
  };
}

export async function saveActiveModelConfiguration(input: unknown, changedByUserId: string) {
  const repositories = getRepositories();
  const existing = await repositories.modelConfig.listConfigurations();
  const models = validateSelectableImageModels(resolveConfiguredSecretPlaceholders(input, existing));
  const result = await repositories.modelConfig.saveConfigurations({
    models,
    changedByUserId,
    changeType: "save"
  });
  const changes = await repositories.modelConfig.listConfigurationChanges(10);
  return {
    ...result,
    configuration: adminSafeActiveModel(result.configurations.find(model => model.enabled && model.isDefault) || result.configurations[0]),
    configurations: result.configurations.map(adminSafeActiveModel),
    change: adminSafeChange(result.change),
    changes: changes.map(adminSafeChange)
  };
}

export async function restoreModelConfiguration(changeId: string, changedByUserId: string) {
  const repositories = getRepositories();
  const change = await repositories.modelConfig.getConfigurationChange(changeId);
  if (!change) {
    throw new ModelConfigurationError("model configuration change was not found", "MODEL_CHANGE_NOT_FOUND", 404);
  }
  const current = await repositories.modelConfig.listConfigurations();
  if (sameSelectableModelList(current.map(editableFromActiveModel), change.afterConfig)) {
    const changes = await repositories.modelConfig.listConfigurationChanges(10);
    return {
      configuration: adminSafeActiveModel(current.find(model => model.enabled && model.isDefault) || current[0]),
      configurations: current.map(adminSafeActiveModel),
      changes: changes.map(adminSafeChange)
    };
  }
  const result = await repositories.modelConfig.saveConfigurations({
    models: change.afterConfig,
    changedByUserId,
    changeType: "restore",
    restoredFromChangeId: change.id,
    testStatus: change.testStatus,
    testError: change.testError
  });
  const changes = await repositories.modelConfig.listConfigurationChanges(10);
  return {
    ...result,
    configuration: adminSafeActiveModel(result.configurations.find(model => model.enabled && model.isDefault) || result.configurations[0]),
    configurations: result.configurations.map(adminSafeActiveModel),
    change: adminSafeChange(result.change),
    changes: changes.map(adminSafeChange)
  };
}

export interface ModelConfigurationTestResult {
  status: Exclude<ModelConfigurationTestStatus, "untested">;
  provider: string;
  model: string;
  durationMs: number;
  message: string;
  testedAt: string;
}

async function testLiveModelConfiguration(config: EditableImageModelConfiguration) {
  const apiKeySecretRef = normalizeSecretRef(config.apiKeySecretRef);
  const secretRefProblem = liveSecretRefProblem(apiKeySecretRef);
  if (secretRefProblem) {
    throw new ModelConfigurationError(secretRefProblem, "MODEL_SECRET_REF_INVALID");
  }
  const apiKey = resolveApiKeySecret(apiKeySecretRef);
  if (!apiKey) {
    throw new ModelConfigurationError(`Missing ${apiKeySecretRef} for live ${config.provider} image generation`, "MODEL_AUTH_MISSING", 500);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: config.model,
      prompt: "FluxArt model configuration test",
      size: "1024x1024"
    };
    if (config.provider === "agnes") {
      body.extra_body = { response_format: "url" };
    } else {
      body.n = 1;
    }

    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new ModelConfigurationError(`model configuration test failed: ${response.status} ${await response.text()}`, "MODEL_TEST_FAILED", 502);
    }

    await response.json().catch(() => undefined);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ModelConfigurationError(`model configuration test timed out after ${config.requestTimeoutMs}ms`, "MODEL_TEST_TIMEOUT", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testModelConfiguration(input: unknown, changedByUserId: string) {
  const repositories = getRepositories();
  const activeModels = await repositories.modelConfig.listConfigurations();
  const config = validateModelConfiguration(resolveConfiguredSecretPlaceholders(input, activeModels)[0] || input);
  const active = await repositories.modelConfig.getActiveConfiguration();
  const startedAt = Date.now();
  const testedAt = new Date().toISOString();

  try {
    if (config.executionMode === "live") {
      await testLiveModelConfiguration(config);
    }
    const result: ModelConfigurationTestResult = {
      status: "passed",
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - startedAt,
      message: config.executionMode === "mock" ? "mock configuration accepted" : "provider returned a successful response",
      testedAt
    };
    if (active && sameEditableConfig(editableFromActive(active), config)) {
      await repositories.modelConfig.updateActiveConfigurationTestResult({
        testStatus: result.status,
        testedAt,
        updatedByUserId: changedByUserId
      });
    }
    return result;
  } catch (error) {
    const result: ModelConfigurationTestResult = {
      status: "failed",
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - startedAt,
      message: errorSummary(error),
      testedAt
    };
    if (active && sameEditableConfig(editableFromActive(active), config)) {
      await repositories.modelConfig.updateActiveConfigurationTestResult({
        testStatus: result.status,
        testedAt,
        testError: result.message,
        updatedByUserId: changedByUserId
      });
    }
    return result;
  }
}
