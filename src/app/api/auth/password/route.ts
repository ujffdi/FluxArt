import { changePassword, AuthServiceError, serializeSessionCookie } from "@/server/auth/auth-service";
import { getCurrentSession } from "@/server/auth/auth-service";
import { getSessionTokenFromCookies } from "@/server/auth/request-auth";
import { fail, ok } from "@/server/shared/api-response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const token = await getSessionTokenFromCookies();
  const session = await getCurrentSession(token);
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("request body must be valid JSON", 400, "INVALID_JSON");
  }

  if (!isRecord(body) || typeof body.currentPassword !== "string" || typeof body.nextPassword !== "string") {
    return fail("currentPassword and nextPassword are required", 400, "PASSWORD_INPUT_REQUIRED");
  }

  try {
    await changePassword({
      userId: session.account.userId,
      currentPassword: body.currentPassword,
      nextPassword: body.nextPassword
    });
    const response = ok({ passwordChanged: true });
    response.headers.append("Set-Cookie", serializeSessionCookie("", 0));
    return response;
  } catch (error) {
    if (error instanceof AuthServiceError) return fail(error.message, error.status, error.code);
    return fail("password change failed", 500, "PASSWORD_CHANGE_FAILED");
  }
}
