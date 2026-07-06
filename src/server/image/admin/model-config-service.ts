import { getRepositories } from "@/server/data/repositories";
import { getEnvImageModelConfig } from "@/server/image/ai/model-config";
import type { ActiveImageModelConfigurationRecord } from "@/server/data/records";
import type { EditableImageModelConfiguration, ModelConfigurationTestStatus } from "@/types/model-config";

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
      provider: "agnes",
      model: "agnes-image-2.1-flash",
      baseUrl: "https://apihub.agnes-ai.com/v1",
      apiKeySecretRef: "FLUXART_IMAGE_API_KEY",
      executionMode: "mock",
      requestTimeoutMs: 120000
    } satisfies EditableImageModelConfiguration
  },
  {
    id: "openai-compatible",
    label: "OpenAI compatible",
    config: {
      provider: "openai",
      model: "gpt-image-2",
      baseUrl: "https://api.openai.com/v1",
      apiKeySecretRef: "FLUXART_IMAGE_API_KEY",
      executionMode: "mock",
      requestTimeoutMs: 120000
    } satisfies EditableImageModelConfiguration
  },
  {
    id: "custom-compatible",
    label: "Custom compatible",
    config: {
      provider: "custom",
      model: "custom-image-model",
      baseUrl: "https://provider.example.com/v1",
      apiKeySecretRef: "CUSTOM_PROVIDER_API_KEY",
      executionMode: "mock",
      requestTimeoutMs: 120000
    } satisfies EditableImageModelConfiguration
  }
];

const supportedProviders = new Set(["agnes", "openai", "custom"]);
const secretRefPattern = /^[A-Z][A-Z0-9_]{1,127}$/;

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
  return error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512);
}

export function validateModelConfiguration(input: unknown): EditableImageModelConfiguration {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const provider = trimString(record.provider);
  const model = trimString(record.model);
  const baseUrl = trimString(record.baseUrl).replace(/\/+$/, "");
  const apiKeySecretRef = trimString(record.apiKeySecretRef);
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
  if (!secretRefPattern.test(apiKeySecretRef)) {
    throw new ModelConfigurationError("apiKeySecretRef must be an uppercase environment variable name", "MODEL_SECRET_REF_INVALID");
  }
  if (!executionMode) {
    throw new ModelConfigurationError("executionMode must be mock or live", "MODEL_EXECUTION_INVALID");
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 1800000) {
    throw new ModelConfigurationError("requestTimeoutMs must be an integer from 1000 to 1800000", "MODEL_TIMEOUT_INVALID");
  }

  return { provider, model, baseUrl, apiKeySecretRef, executionMode, requestTimeoutMs };
}

function activeFromEnv(): ActiveImageModelConfigurationRecord {
  const envConfig = getEnvImageModelConfig();
  const now = new Date().toISOString();
  return {
    id: "active",
    provider: String(envConfig.provider),
    model: envConfig.model,
    baseUrl: envConfig.baseUrl || "https://apihub.agnes-ai.com/v1",
    apiKeySecretRef: envConfig.apiKeySecretRef || "FLUXART_IMAGE_API_KEY",
    executionMode: envConfig.executionMode,
    requestTimeoutMs: envConfig.requestTimeoutMs,
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

export async function getModelAdministrationState() {
  const repositories = getRepositories();
  const active = await repositories.modelConfig.getActiveConfiguration();
  return {
    configuration: active || activeFromEnv(),
    configurationSource: active ? "data" : "env",
    changes: await repositories.modelConfig.listConfigurationChanges(10),
    presets: modelConfigurationPresets
  };
}

export async function saveActiveModelConfiguration(input: unknown, changedByUserId: string) {
  const config = validateModelConfiguration(input);
  const repositories = getRepositories();
  const result = await repositories.modelConfig.saveActiveConfiguration({
    config,
    changedByUserId,
    changeType: "save"
  });
  return {
    ...result,
    changes: await repositories.modelConfig.listConfigurationChanges(10)
  };
}

export async function restoreModelConfiguration(changeId: string, changedByUserId: string) {
  const repositories = getRepositories();
  const change = await repositories.modelConfig.getConfigurationChange(changeId);
  if (!change) {
    throw new ModelConfigurationError("model configuration change was not found", "MODEL_CHANGE_NOT_FOUND", 404);
  }
  const result = await repositories.modelConfig.saveActiveConfiguration({
    config: change.afterConfig,
    changedByUserId,
    changeType: "restore",
    restoredFromChangeId: change.id,
    testStatus: change.testStatus,
    testError: change.testError
  });
  return {
    ...result,
    changes: await repositories.modelConfig.listConfigurationChanges(10)
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
  const apiKey = process.env[config.apiKeySecretRef];
  if (!apiKey) {
    throw new ModelConfigurationError(`Missing ${config.apiKeySecretRef} for live ${config.provider} image generation`, "MODEL_AUTH_MISSING", 500);
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
  const config = validateModelConfiguration(input);
  const repositories = getRepositories();
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
