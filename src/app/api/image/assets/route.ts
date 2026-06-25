import { listAssets } from "@/server/image/business/image-service";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { parseAssetListQuery } from "@/server/image/business/list-query";
import { fail, ok } from "@/server/shared/api-response";

export async function GET(request: Request) {
  const parsedQuery = parseAssetListQuery(new URL(request.url).searchParams);
  if (!parsedQuery.ok) {
    return fail(parsedQuery.error.message, 400, parsedQuery.error.errorCode);
  }

  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");
  return renewSessionCookie(ok(await listAssets(parsedQuery.query, session.account.userId)), session.sessionToken, session.session);
}
