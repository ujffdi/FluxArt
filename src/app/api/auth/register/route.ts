import { registerSelfDeclaredAccount, AuthServiceError, serializeSessionCookie } from "@/server/auth/auth-service";
import { getRequestUserAgent, getTrustedClientIp } from "@/server/auth/request-metadata";
import { fail, ok } from "@/server/shared/api-response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return fail("request body must be valid JSON", 400, "INVALID_JSON");
  }

  if (!isRecord(body) || typeof body.username !== "string" || typeof body.password !== "string") {
    return fail("username and password are required", 400, "AUTH_INPUT_REQUIRED");
  }

  try {
    const result = await registerSelfDeclaredAccount({
      username: body.username,
      password: body.password,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      userAgent: getRequestUserAgent(request),
      ipAddress: getTrustedClientIp(request)
    });
    const response = ok({ account: result.account, session: result.session });
    response.headers.append("Set-Cookie", serializeSessionCookie(result.sessionToken));
    return response;
  } catch (error) {
    if (error instanceof AuthServiceError) return fail(error.message, error.status, error.code);
    return fail("registration failed", 500, "AUTH_REGISTER_FAILED");
  }
}
