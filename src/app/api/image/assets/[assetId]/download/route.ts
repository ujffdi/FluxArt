import { confirmDownload, getAsset } from "@/server/image/business/image-service";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { fail, ok } from "@/server/shared/api-response";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  const { assetId } = await context.params;
  if (!(await getAsset(assetId, session.account.userId))) {
    return fail("image asset not found", 404, "ASSET_NOT_FOUND");
  }
  return renewSessionCookie(ok({ decision: await confirmDownload(assetId, session.account.userId) }), session.sessionToken, session.session);
}
