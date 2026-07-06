import { requireAdminRequest } from "@/server/admin/admin-auth";
import { renewSessionCookie } from "@/server/auth/request-auth";
import { getModelAdministrationState, ModelConfigurationError, saveActiveModelConfiguration } from "@/server/image/admin/model-config-service";
import { fail, ok } from "@/server/shared/api-response";

export async function GET(request: Request) {
  const admin = await requireAdminRequest(request);
  if ("response" in admin) return admin.response;

  const response = ok(await getModelAdministrationState());
  return renewSessionCookie(response, admin.session.sessionToken, admin.session.session);
}

export async function PUT(request: Request) {
  const admin = await requireAdminRequest(request);
  if ("response" in admin) return admin.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("request body must be valid JSON", 400, "INVALID_JSON");
  }

  try {
    const config = typeof body === "object" && body !== null && "config" in body
      ? (body as { config?: unknown }).config
      : body;
    const response = ok(await saveActiveModelConfiguration(config, admin.session.account.userId));
    return renewSessionCookie(response, admin.session.sessionToken, admin.session.session);
  } catch (error) {
    if (error instanceof ModelConfigurationError) {
      return fail(error.message, error.status, error.code);
    }
    return fail(error instanceof Error ? error.message : "model configuration save failed", 500, "MODEL_CONFIG_SAVE_FAILED");
  }
}
