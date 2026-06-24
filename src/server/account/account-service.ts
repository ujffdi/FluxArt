import { getRepositories } from "@/server/data/repositories";
import type { AccountCreditsSummary, AccountMembershipSummary } from "@/types/image";

export async function getCreditsSummary(): Promise<AccountCreditsSummary> {
  const account = await getRepositories().account.getCurrentAccount();

  return {
    userId: account.userId,
    credits: account.credits,
    estimatedStandardGenerations: Math.floor(account.credits / 18),
    recentChanges: [
      {
        id: "ledger-demo-1",
        label: "Pro 试用赠送积分",
        amount: 300,
        balanceAfter: account.credits,
        createdAt: "今天 09:00"
      },
      {
        id: "ledger-demo-2",
        label: "文生图任务扣减",
        amount: -18,
        balanceAfter: account.credits - 300,
        createdAt: "今天 10:24"
      }
    ]
  };
}

export async function getMembershipSummary(): Promise<AccountMembershipSummary> {
  const account = await getRepositories().account.getCurrentAccount();

  return {
    userId: account.userId,
    memberStatus: account.memberStatus,
    proDaysRemaining: account.proDaysRemaining,
    canUseOutpaint: account.canUseOutpaint,
    canDownloadHd: account.canDownloadHd,
    canDownloadWithoutWatermark: account.canDownloadWithoutWatermark
  };
}
