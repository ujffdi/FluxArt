import type { AccountEntitlement } from "@/types/image";

export const billingPlanIds = ["credits-1500", "credits-5000", "pro-monthly"] as const;

export type BillingPlanId = (typeof billingPlanIds)[number];

export interface BillingOrder {
  orderId: string;
  planId: BillingPlanId;
  userId: string;
  status: "pending_payment" | "paid" | "failed" | "refunded";
  creditsAfterPayment: number;
  memberStatusAfterPayment: AccountEntitlement["memberStatus"];
  createdAt: string;
}
