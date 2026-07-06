import { timingSafeEqual } from "node:crypto";
import { getRequestSession } from "@/server/auth/request-auth";
import { fail } from "@/server/shared/api-response";

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

  const configuredSecret = process.env.FLUXART_ADMIN_SECRET;
  if (!configuredSecret) {
    return { response: fail("admin secret is not configured", 503, "ADMIN_SECRET_NOT_CONFIGURED") };
  }

  const requestSecret = readSecretFromRequest(request);
  if (!requestSecret || !safeSecretEqual(requestSecret, configuredSecret)) {
    return { response: fail("admin secret is invalid", 403, "ADMIN_SECRET_INVALID") };
  }

  return { session };
}
