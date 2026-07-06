import type { AccountEntitlement } from "@/types/image";

export type BillingPlanId = "credits-500" | "credits-1500" | "credits-5000";

export interface BillingOrder {
  orderId: string;
  planId: BillingPlanId;
  userId: string;
  status: "pending_payment" | "paid" | "failed" | "refunded";
  fulfillmentStatus?: "pending" | "fulfilled" | "failed" | "retryable";
  outTradeNo?: string;
  amountCents?: number;
  currency?: "CNY";
  paymentUrl?: string;
  creditsAfterPayment: number;
  memberStatusAfterPayment: AccountEntitlement["memberStatus"];
  createdAt: string;
}

export interface BillingPlan {
  planId: BillingPlanId;
  displayName: string;
  credits: number;
  amountCents: number;
  kind: "credit_pack";
}
