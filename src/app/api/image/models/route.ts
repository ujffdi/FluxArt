import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { getRepositories } from "@/server/data/repositories";
import { getUserModelSelectionState } from "@/server/image/ai/model-config";
import { fail, ok } from "@/server/shared/api-response";

export async function GET() {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");
  const account = await getRepositories().account.getCurrentAccount(session.account.userId);
  const state = await getUserModelSelectionState(account);
  return renewSessionCookie(ok({ modelSelection: state }), session.sessionToken, session.session);
}
