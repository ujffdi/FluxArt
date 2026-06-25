import sharp from "sharp";
import type { CreateImageTaskInput } from "@/types/image";
import { getImageModelConfig } from "./model-config";

export interface ModelSubmission {
  provider: string;
  modelName: string;
  externalTaskId: string;
  estimatedDurationMs: number;
  providerMode: "sync" | "async";
  outputBytes?: Buffer;
  outputBytesList?: Buffer[];
}

interface AsyncPollInput {
  provider: string;
  modelName: string;
  externalTaskId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function createMockOutput(input: CreateImageTaskInput, index = 0) {
  const [width, height] = String(input.size || "1024x1024").split("x").map(value => Number(value));
  const backgrounds = input.taskType === "outpaint"
    ? ["#134e4a", "#0f766e", "#115e59", "#0f766e"]
    : input.taskType === "inpaint"
      ? ["#3730a3", "#4338ca", "#4f46e5", "#312e81"]
      : ["#0f172a", "#1e293b", "#334155", "#111827"];
  return sharp({
    create: {
      width: Number.isFinite(width) ? width : 1024,
      height: Number.isFinite(height) ? height : 1024,
      channels: 3,
      background: backgrounds[index % backgrounds.length]
    }
  }).png().toBuffer();
}

async function outputBytesFromPayload(payload: unknown, provider: string) {
  const outputs = isRecord(payload) && Array.isArray(payload.data)
    ? payload.data.filter(isRecord)
    : [];
  const outputBytesList: Buffer[] = [];

  for (const output of outputs) {
    const b64Json = typeof output.b64_json === "string" ? output.b64_json : undefined;
    const outputUrl = typeof output.url === "string" ? output.url : undefined;
    if (b64Json) {
      outputBytesList.push(Buffer.from(b64Json, "base64"));
    } else if (outputUrl) {
      const outputResponse = await fetch(outputUrl);
      if (!outputResponse.ok) {
        throw new Error(`${provider} image output download failed: ${outputResponse.status} ${await outputResponse.text()}`);
      }
      outputBytesList.push(Buffer.from(await outputResponse.arrayBuffer()));
    }
  }

  return outputBytesList;
}

export async function submitImageGeneration(input: CreateImageTaskInput): Promise<ModelSubmission> {
  const config = getImageModelConfig();
  const provider = config.provider;
  const modelName = config.model;

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

    const payload = await response.json().catch(() => undefined);
    const outputBytesList = await outputBytesFromPayload(payload, provider);

    return {
      provider,
      modelName,
      externalTaskId: response.headers.get("x-request-id") || `OPENAI-${Date.now().toString(36)}`,
      estimatedDurationMs: input.taskType === "t2i" ? 12000 : 18000,
      providerMode: outputBytesList.length ? "sync" : "async",
      outputBytes: outputBytesList[0],
      outputBytesList
    };
  }

  // Default local execution is deterministic mock mode so the V1 can run
  // without external credentials, while preserving the production adapter seam.
  const outputBytesList = await Promise.all(
    Array.from({ length: Math.max(1, input.count || 1) }, (_, index) => createMockOutput(input, index))
  );
  return {
    provider,
    modelName,
    externalTaskId: `${String(provider).toUpperCase()}-${Date.now().toString(36)}`,
    estimatedDurationMs: input.taskType === "t2i" ? 12000 : 18000,
    providerMode: "sync",
    outputBytes: outputBytesList[0],
    outputBytesList
  };
}

export async function pollImageGenerationResult(input: AsyncPollInput): Promise<ModelSubmission> {
  const config = getImageModelConfig();
  const provider = config.provider;
  const modelName = config.model;

  if (config.executionMode !== "live") {
    return {
      provider: input.provider || provider,
      modelName: input.modelName || modelName,
      externalTaskId: input.externalTaskId,
      estimatedDurationMs: 0,
      providerMode: "async"
    };
  }

  const apiKey = process.env[config.apiKeySecretRef || "OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(`Missing ${config.apiKeySecretRef || "OPENAI_API_KEY"} for live ${provider} image generation`);
  }

  const template = process.env.IMAGE_MODEL_ASYNC_RESULT_URL_TEMPLATE;
  const resultUrl = template
    ? template.replace("{externalTaskId}", encodeURIComponent(input.externalTaskId))
    : `${config.baseUrl}/images/generations/${encodeURIComponent(input.externalTaskId)}`;
  const response = await fetch(resultUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`${provider} async image result failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json().catch(() => undefined);
  const outputBytesList = await outputBytesFromPayload(payload, provider);

  return {
    provider,
    modelName,
    externalTaskId: input.externalTaskId,
    estimatedDurationMs: 0,
    providerMode: outputBytesList.length ? "sync" : "async",
    outputBytes: outputBytesList[0],
    outputBytesList
  };
}
