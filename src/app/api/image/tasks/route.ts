import { createTask, getAsset, listTasks } from "@/server/image/business/image-service";
import { parseTaskListQuery } from "@/server/image/business/list-query";
import { fail, ok } from "@/server/shared/api-response";
import type { CreateImageTaskInput, GenerationMode } from "@/types/image";

const taskTypes = new Set<GenerationMode>(["t2i", "i2i", "inpaint", "outpaint"]);
const sizePattern = /^\d{3,4}x\d{3,4}$/;

export async function GET(request: Request) {
  const parsedQuery = parseTaskListQuery(new URL(request.url).searchParams);
  if (!parsedQuery.ok) {
    return fail(parsedQuery.error.message, 400, parsedQuery.error.errorCode);
  }

  return ok(await listTasks(parsedQuery.query));
}

export async function POST(request: Request) {
  let body: Partial<CreateImageTaskInput>;

  try {
    body = (await request.json()) as Partial<CreateImageTaskInput>;
  } catch {
    return fail("request body must be valid JSON", 400, "INVALID_JSON");
  }

  if (!body.taskType || !body.prompt) {
    return fail("taskType and prompt are required", 400, "TASK_INPUT_REQUIRED");
  }

  if (!taskTypes.has(body.taskType)) {
    return fail("unsupported taskType", 400, "TASK_TYPE_UNSUPPORTED");
  }

  if (body.count !== undefined && (!Number.isInteger(body.count) || body.count < 1 || body.count > 4)) {
    return fail("count must be an integer between 1 and 4", 400, "COUNT_OUT_OF_RANGE");
  }

  if (body.size !== undefined && !sizePattern.test(body.size)) {
    return fail("size must use WIDTHxHEIGHT format", 400, "SIZE_INVALID");
  }

  if (body.taskType !== "t2i") {
    if (!body.sourceAssetId) {
      return fail("sourceAssetId is required for image editing tasks", 400, "SOURCE_ASSET_REQUIRED");
    }

    const sourceAsset = await getAsset(body.sourceAssetId);
    if (!sourceAsset) {
      return fail("source asset was not found", 404, "SOURCE_ASSET_NOT_FOUND");
    }
  }

  try {
    const task = await createTask({
      taskType: body.taskType,
      prompt: body.prompt,
      negativePrompt: body.negativePrompt,
      sourceAssetId: body.sourceAssetId,
      size: body.size || "1024x1024",
      count: body.count || 4,
      stylePreset: body.stylePreset || "商业摄影",
      strength: body.strength,
      modelProvider: body.modelProvider,
      modelName: body.modelName
    });

    return ok({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "model request failed";
    if (message.startsWith("Missing ")) {
      return fail(message, 500, "MODEL_AUTH_MISSING");
    }
    return fail(message, 502, "MODEL_REQUEST_FAILED");
  }
}
