import { getCreditsSummary } from "@/server/account/account-service";
import { ok } from "@/server/shared/api-response";

export async function GET() {
  return ok({ credits: await getCreditsSummary() });
}
