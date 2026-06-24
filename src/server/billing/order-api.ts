import { createMockOrder } from "@/server/billing/billing-service";
import { fail, ok } from "@/server/shared/api-response";
import { billingPlanIds, type BillingPlanId } from "@/types/billing";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBillingPlanId(value: unknown): value is BillingPlanId {
  return typeof value === "string" && billingPlanIds.some(planId => planId === value);
}

export async function createOrderResponse(
  request: Request,
  options: {
    allowedPlanIds?: BillingPlanId[];
    invalidPlanCode?: string;
  } = {}
) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return fail("request body must be valid JSON", 400, "INVALID_JSON");
  }

  if (!isRecord(body) || !isBillingPlanId(body.planId)) {
    return fail("supported planId is required", 400, options.invalidPlanCode || "PLAN_ID_REQUIRED");
  }

  if (options.allowedPlanIds && !options.allowedPlanIds.includes(body.planId)) {
    return fail("planId is not supported by this order endpoint", 400, options.invalidPlanCode || "PLAN_ID_REQUIRED");
  }

  return ok({ order: await createMockOrder(body.planId) });
}
