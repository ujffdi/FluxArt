import { createOrderResponse } from "@/server/billing/order-api";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { listBillingOrders } from "@/server/billing/billing-service";
import { fail, ok } from "@/server/shared/api-response";

export async function GET() {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");
  return renewSessionCookie(ok({ orders: await listBillingOrders(session.account.userId) }), session.sessionToken, session.session);
}

export async function POST(request: Request) {
  return createOrderResponse(request);
}
