import { getTask } from "@/server/image/business/image-service";
import { fail, ok } from "@/server/shared/api-response";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const task = await getTask(taskId);

  if (!task) {
    return fail("image task not found", 404, "TASK_NOT_FOUND");
  }

  return ok({ task });
}
