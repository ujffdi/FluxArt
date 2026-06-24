import { createOrderResponse } from "@/server/billing/order-api";

export async function POST(request: Request) {
  return createOrderResponse(request, {
    allowedPlanIds: ["pro-monthly"],
    invalidPlanCode: "MEMBERSHIP_PLAN_REQUIRED"
  });
}
