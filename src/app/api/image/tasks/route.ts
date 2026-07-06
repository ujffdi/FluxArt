import { createTask, getAsset, listTasks } from "@/server/image/business/image-service";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { CreditBalanceError } from "@/server/credits/credit-service";
import { TaskCapabilityError, TaskConcurrencyError } from "@/server/image/business/task-policy";
import { parseTaskListQuery } from "@/server/image/business/list-query";
import { fail, ok } from "@/server/shared/api-response";
import type { CreateImageTaskInput, GenerationMode, StructureMode } from "@/types/image";

const taskTypes = new Set<GenerationMode>(["t2i", "i2i", "inpaint", "outpaint"]);
const structureModes = new Set<StructureMode>(["balanced", "outline", "pose"]);
const sizePattern = /^\d{3,4}x\d{3,4}$/;

export async function GET(request: Request) {
  const parsedQuery = parseTaskListQuery(new URL(request.url).searchParams);
  if (!parsedQuery.ok) {
    return fail(parsedQuery.error.message, 400, parsedQuery.error.errorCode);
  }

  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");
  return renewSessionCookie(ok(await listTasks(parsedQuery.query, session.account.userId)), session.sessionToken, session.session);
}

export async function POST(request: Request) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

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

  if (body.strength !== undefined && (!Number.isFinite(body.strength) || body.strength < 0 || body.strength > 100)) {
    return fail("strength must be a number between 0 and 100", 400, "STRENGTH_OUT_OF_RANGE");
  }

  if (body.structureMode !== undefined && !structureModes.has(body.structureMode)) {
    return fail("unsupported structureMode", 400, "STRUCTURE_MODE_UNSUPPORTED");
  }

  if (body.taskType !== "t2i") {
    if (!body.sourceAssetId) {
      return fail("sourceAssetId is required for source-based image tasks", 400, "SOURCE_ASSET_REQUIRED");
    }

    const sourceAsset = await getAsset(body.sourceAssetId, session.account.userId);
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
      structureMode: body.structureMode,
      selectedImageModelId: typeof body.selectedImageModelId === "string" ? body.selectedImageModelId : undefined
    }, session.account.userId);

    return renewSessionCookie(ok({ task }), session.sessionToken, session.session);
  } catch (error) {
    if (error instanceof CreditBalanceError) {
      return fail(error.message, error.status, error.code);
    }
    if (error instanceof TaskCapabilityError || error instanceof TaskConcurrencyError) {
      return fail(error.message, error.status, error.code);
    }
    const message = error instanceof Error ? error.message : "model request failed";
    if (message.startsWith("Missing ")) {
      return fail(message, 500, "MODEL_AUTH_MISSING");
    }
    return fail(message, 502, "MODEL_REQUEST_FAILED");
  }
}
