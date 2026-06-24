import { getAssetDetail } from "@/server/image/business/image-service";
import { fail, ok } from "@/server/shared/api-response";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { assetId } = await context.params;
  const detail = await getAssetDetail(assetId);

  if (!detail) {
    return fail("image asset not found", 404, "ASSET_NOT_FOUND");
  }

  return ok({ detail });
}
