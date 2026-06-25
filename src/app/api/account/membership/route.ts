import { getMembershipSummary } from "@/server/account/account-service";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { fail, ok } from "@/server/shared/api-response";

export async function GET() {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");
  return renewSessionCookie(ok({ membership: await getMembershipSummary(session.account.userId) }), session.sessionToken, session.session);
}
