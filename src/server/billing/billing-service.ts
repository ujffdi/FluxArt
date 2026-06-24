import { getRepositories } from "@/server/data/repositories";
import type { BillingPlanId } from "@/types/billing";

export async function createMockOrder(planId: BillingPlanId) {
  const repositories = getRepositories();
  const account = await repositories.account.getCurrentAccount();

  return repositories.billing.createOrder({
    planId,
    userId: account.userId,
    creditsAfterPayment: account.credits + (planId === "credits-5000" ? 5000 : 1500),
    memberStatusAfterPayment: planId === "pro-monthly" ? "pro" : account.memberStatus
  });
}
