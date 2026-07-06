import type { ImageProvider } from "@/types/image";
import { getRepositories } from "@/server/data/repositories";

export interface ImageModelConfig {
  provider: ImageProvider | string;
  model: string;
  baseUrl?: string;
  apiKeySecretRef?: string;
  executionMode: "mock" | "live";
  requestTimeoutMs: number;
}

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
