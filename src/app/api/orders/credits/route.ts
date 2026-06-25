import { createOrderResponse } from "@/server/billing/order-api";

export async function POST(request: Request) {
  return createOrderResponse(request, {
    allowedPlanIds: ["credits-500", "credits-1500", "credits-5000"],
    invalidPlanCode: "CREDIT_PLAN_REQUIRED"
  });
}
