import { getTask, runImageTask } from "@/server/image/business/image-service";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { fail, ok } from "@/server/shared/api-response";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  const { taskId } = await context.params;
  const task = await getTask(taskId, session.account.userId);

  if (!task) {
    return fail("image task not found", 404, "TASK_NOT_FOUND");
  }

  return renewSessionCookie(ok({ task }), session.sessionToken, session.session);
}

export async function POST(_request: Request, context: RouteContext) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  const { taskId } = await context.params;
  const task = await runImageTask(taskId, session.account.userId);

  if (!task) {
    return fail("image task not found", 404, "TASK_NOT_FOUND");
  }

  return renewSessionCookie(ok({ task }), session.sessionToken, session.session);
}
