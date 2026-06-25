import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { fail, ok } from "@/server/shared/api-response";

export async function GET() {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");
  return renewSessionCookie(ok({ account: session.account, session: session.session }), session.sessionToken, session.session);
}
