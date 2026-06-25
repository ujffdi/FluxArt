import { getRepositories } from "@/server/data/repositories";
import { grantDailyFreeCreditsIfNeeded } from "@/server/credits/credit-service";
import type { AccountCreditsSummary, AccountMembershipSummary } from "@/types/image";

export const proCommercialAuthorizationStatement = "Pro paid membership grants commercial use authorization for generated assets created while the membership cycle is active, subject to FluxArt content and usage policies.";

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

export async function getMembershipSummary(userId?: string): Promise<AccountMembershipSummary> {
  const repositories = getRepositories();
  const account = await repositories.account.getCurrentAccount(userId);
  const now = Date.now();
  const activeCycle = userId
    ? (await repositories.billing.listMembershipCycles(userId))
      .filter(cycle => cycle.status === "active" && Date.parse(cycle.cycleStart) <= now && Date.parse(cycle.cycleEnd) > now)
      .sort((left, right) => Date.parse(right.cycleEnd) - Date.parse(left.cycleEnd))[0]
    : undefined;

  return {
    userId: account.userId,
    memberStatus: account.memberStatus,
    proDaysRemaining: account.proDaysRemaining,
    canUseOutpaint: account.canUseOutpaint,
    canDownloadHd: account.canDownloadHd,
    canDownloadWithoutWatermark: account.canDownloadWithoutWatermark,
    includedHdDownloadsRemaining: activeCycle ? Math.max(0, activeCycle.hdFairUseCap - activeCycle.hdDownloadsUsed) : undefined,
    commercialAuthorizationStatement: account.memberStatus === "pro" ? proCommercialAuthorizationStatement : undefined
  };
}
