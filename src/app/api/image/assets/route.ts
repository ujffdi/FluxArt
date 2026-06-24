import { listAssets } from "@/server/image/business/image-service";
import { parseAssetListQuery } from "@/server/image/business/list-query";
import { fail, ok } from "@/server/shared/api-response";

export async function GET(request: Request) {
  const parsedQuery = parseAssetListQuery(new URL(request.url).searchParams);
  if (!parsedQuery.ok) {
    return fail(parsedQuery.error.message, 400, parsedQuery.error.errorCode);
  }

  return ok(await listAssets(parsedQuery.query));
}
