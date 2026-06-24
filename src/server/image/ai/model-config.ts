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
    provider: process.env.IMAGE_MODEL_PROVIDER || "openai",
    model: process.env.OPENAI_IMAGE_MODEL || process.env.IMAGE_MODEL_NAME || "gpt-image-2",
    baseUrl: process.env.IMAGE_MODEL_BASE_URL || "https://api.openai.com/v1",
    apiKeySecretRef: process.env.IMAGE_MODEL_API_KEY_SECRET_REF || "OPENAI_API_KEY",
    executionMode: process.env.IMAGE_MODEL_EXECUTION === "live" ? "live" : "mock"
  };
}
