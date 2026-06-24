import { decideDownload, getAsset } from "@/server/image/business/image-service";
import { fail, ok } from "@/server/shared/api-response";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { assetId } = await context.params;
  if (!(await getAsset(assetId))) {
    return fail("image asset not found", 404, "ASSET_NOT_FOUND");
  }
  return ok({ decision: await decideDownload(assetId) });
}
