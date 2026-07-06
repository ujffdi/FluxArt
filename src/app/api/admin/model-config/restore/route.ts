import { requireAdminRequest } from "@/server/admin/admin-auth";
import { renewSessionCookie } from "@/server/auth/request-auth";
import { ModelConfigurationError, restoreModelConfiguration } from "@/server/image/admin/model-config-service";
import { fail, ok } from "@/server/shared/api-response";

export async function POST(request: Request) {
  const admin = await requireAdminRequest(request);
  if ("response" in admin) return admin.response;

  let body: { changeId?: string };
  try {
    body = await request.json() as { changeId?: string };
  } catch {
    return fail("request body must be valid JSON", 400, "INVALID_JSON");
  }

  if (!body.changeId) {
    return fail("changeId is required", 400, "MODEL_CHANGE_ID_REQUIRED");
  }

  try {
    const response = ok(await restoreModelConfiguration(body.changeId, admin.session.account.userId));
    return renewSessionCookie(response, admin.session.sessionToken, admin.session.session);
  } catch (error) {
    if (error instanceof ModelConfigurationError) {
      return fail(error.message, error.status, error.code);
    }
    return fail(error instanceof Error ? error.message : "model configuration restore failed", 500, "MODEL_CONFIG_RESTORE_FAILED");
  }
}
