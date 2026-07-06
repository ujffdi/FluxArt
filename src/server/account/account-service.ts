import { getRepositories } from "@/server/data/repositories";
import { grantDailyFreeCreditsIfNeeded } from "@/server/credits/credit-service";
import type { AccountCreditsSummary } from "@/types/image";

export async function getCreditsSummary(userId?: string): Promise<AccountCreditsSummary> {
  const repositories = getRepositories();
  if (userId) await grantDailyFreeCreditsIfNeeded(userId);
  const account = await repositories.account.getCurrentAccount(userId);
  const [buckets, ledgerEntries] = await Promise.all([
    repositories.credits.listBuckets(account.userId),
    repositories.credits.listLedgerEntries(account.userId, 10)
  ]);
  const current = new Date().toISOString();

  return {
    userId: account.userId,
    credits: account.credits,
    estimatedStandardGenerations: Math.floor(account.credits / 10),
    groups: buckets
      .filter(bucket => bucket.remainingAmount > 0 && bucket.validFrom <= current && (!bucket.validUntil || bucket.validUntil > current))
      .sort((left, right) => left.priority - right.priority || (left.validUntil || "9999").localeCompare(right.validUntil || "9999"))
      .map(bucket => ({
        label: bucket.sourceType === "registration" ? "注册赠送 Promotional Credits" : bucket.sourceType === "daily_free" ? "每日免费 Promotional Credits" : bucket.creditType === "purchased" ? "已购积分额度" : bucket.sourceType,
        amount: bucket.remainingAmount,
        validUntil: bucket.validUntil
      })),
    recentChanges: ledgerEntries.map(entry => ({
      id: entry.id,
      label: entry.label,
      amount: entry.amount,
      balanceAfter: entry.balanceAfter,
      createdAt: entry.createdAt
    }))
  };
}
