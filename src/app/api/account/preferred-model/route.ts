import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { PreferredModelError, savePreferredImageModel } from "@/server/image/business/preferred-model-service";
import { fail, ok } from "@/server/shared/api-response";

export async function POST(request: Request) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  const body = await request.json().catch(() => ({})) as { modelId?: unknown };
  try {
    const modelSelection = await savePreferredImageModel(session.account.userId, body.modelId);
    return renewSessionCookie(ok({ modelSelection }), session.sessionToken, session.session);
  } catch (error) {
    if (error instanceof PreferredModelError) {
      return fail(error.message, error.status, error.code);
    }
    return fail("preferred model save failed", 500, "PREFERRED_MODEL_SAVE_FAILED");
  }
}
