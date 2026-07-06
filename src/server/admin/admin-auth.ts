import { timingSafeEqual } from "node:crypto";
import { getRequestSession } from "@/server/auth/request-auth";
import { fail } from "@/server/shared/api-response";
import { isModelAdminUsername } from "./admin-policy";

function readSecretFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return request.headers.get("x-fluxart-admin-secret") || "";
}

function safeSecretEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function requireAdminRequest(request: Request) {
  const session = await getRequestSession();
  if (!session) return { response: fail("authentication is required", 401, "AUTH_REQUIRED") };

  if (isModelAdminUsername(session.account.username)) {
    return { session };
  }

  const configuredSecret = process.env.FLUXART_ADMIN_SECRET;
  const requestSecret = readSecretFromRequest(request);
  if (configuredSecret && requestSecret && safeSecretEqual(requestSecret, configuredSecret)) {
    return { session };
  }

  return {
    response: fail(
      configuredSecret ? "admin account or secret is required" : "account is not allowed for model administration",
      403,
      configuredSecret ? "ADMIN_SECRET_INVALID" : "ADMIN_ACCOUNT_NOT_ALLOWED"
    )
  };
}
