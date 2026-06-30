import type { ImageProvider } from "@/types/image";

export interface ImageModelConfig {
  provider: ImageProvider | string;
  model: string;
  baseUrl?: string;
  apiKeySecretRef?: string;
  executionMode: "mock" | "live";
}

export function getImageModelConfig(): ImageModelConfig {
  return {
    provider: process.env.IMAGE_MODEL_PROVIDER || "agnes",
    model: process.env.IMAGE_MODEL_NAME || process.env.OPENAI_IMAGE_MODEL || "agnes-image-2.1-flash",
    baseUrl: process.env.IMAGE_MODEL_BASE_URL || "https://apihub.agnes-ai.com/v1",
    apiKeySecretRef: process.env.IMAGE_MODEL_API_KEY_SECRET_REF || "FLUXART_IMAGE_API_KEY",
    executionMode: process.env.IMAGE_MODEL_EXECUTION === "live" ? "live" : "mock"
  };
}
