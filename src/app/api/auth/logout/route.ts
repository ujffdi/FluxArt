import { logoutSession, serializeSessionCookie } from "@/server/auth/auth-service";
import { getSessionTokenFromCookies } from "@/server/auth/request-auth";
import { ok } from "@/server/shared/api-response";

export async function POST() {
  await logoutSession(await getSessionTokenFromCookies());
  const response = ok({ loggedOut: true });
  response.headers.append("Set-Cookie", serializeSessionCookie("", 0));
  return response;
}
