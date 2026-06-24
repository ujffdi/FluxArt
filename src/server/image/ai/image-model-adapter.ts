import type { CreateImageTaskInput } from "@/types/image";
import { getImageModelConfig } from "./model-config";

export interface ModelSubmission {
  provider: string;
  modelName: string;
  externalTaskId: string;
  estimatedDurationMs: number;
}

export async function submitImageGeneration(input: CreateImageTaskInput): Promise<ModelSubmission> {
  const config = getImageModelConfig();
  const provider = input.modelProvider || config.provider;
  const modelName = input.modelName || config.model;

  if (config.executionMode === "live") {
    const apiKey = process.env[config.apiKeySecretRef || "OPENAI_API_KEY"];
    if (!apiKey) {
      throw new Error(`Missing ${config.apiKeySecretRef || "OPENAI_API_KEY"} for live ${provider} image generation`);
    }

    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        prompt: input.prompt,
        size: input.size || "1024x1024",
        n: input.count || 1
      })
    });

    if (!response.ok) {
      throw new Error(`${provider} image generation failed: ${response.status} ${await response.text()}`);
    }

    return {
      provider,
      modelName,
      externalTaskId: response.headers.get("x-request-id") || `OPENAI-${Date.now().toString(36)}`,
      estimatedDurationMs: input.taskType === "t2i" ? 12000 : 18000
    };
  }

  // Default local execution is deterministic mock mode so the V1 can run
  // without external credentials, while preserving the production adapter seam.
  return {
    provider,
    modelName,
    externalTaskId: `${String(provider).toUpperCase()}-${Date.now().toString(36)}`,
    estimatedDurationMs: input.taskType === "t2i" ? 12000 : 18000
  };
}
