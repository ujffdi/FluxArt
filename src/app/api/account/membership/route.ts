import { getMembershipSummary } from "@/server/account/account-service";
import { ok } from "@/server/shared/api-response";

export async function GET() {
  return ok({ membership: await getMembershipSummary() });
}
