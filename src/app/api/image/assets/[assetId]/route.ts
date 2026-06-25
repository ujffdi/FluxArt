import { deleteAsset, getAssetDetail } from "@/server/image/business/image-service";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { fail, ok } from "@/server/shared/api-response";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  const { assetId } = await context.params;
  const detail = await getAssetDetail(assetId, session.account.userId);

  if (!detail) {
    return fail("image asset not found", 404, "ASSET_NOT_FOUND");
  }

  return renewSessionCookie(ok({ detail }), session.sessionToken, session.session);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  const { assetId } = await context.params;
  const asset = await deleteAsset(assetId, session.account.userId);

  if (!asset) {
    return fail("image asset not found", 404, "ASSET_NOT_FOUND");
  }

  return renewSessionCookie(ok({ asset }), session.sessionToken, session.session);
}
