import type { BillingPlan, BillingPlanId } from "@/types/billing";

export const billingPlanIds: BillingPlanId[] = ["credits-500", "credits-1500", "credits-5000", "pro-monthly"];

export const billingPlans: Record<BillingPlanId, BillingPlan> = {
  "credits-500": {
    planId: "credits-500",
    displayName: "500 Credit Pack",
    credits: 500,
    amountCents: 2900,
    kind: "credit_pack"
  },
  "credits-1500": {
    planId: "credits-1500",
    displayName: "1500 Credit Pack",
    credits: 1500,
    amountCents: 7900,
    kind: "credit_pack"
  },
  "credits-5000": {
    planId: "credits-5000",
    displayName: "5000 Credit Pack",
    credits: 5000,
    amountCents: 19900,
    kind: "credit_pack"
  },
  "pro-monthly": {
    planId: "pro-monthly",
    displayName: "Pro 月度会员",
    credits: 1000,
    amountCents: 6900,
    kind: "membership"
  }
};
