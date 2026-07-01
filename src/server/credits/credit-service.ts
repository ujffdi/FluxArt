import { randomUUID } from "node:crypto";
import { getRepositories } from "@/server/data/repositories";
import { localTestToolsEnabled } from "@/server/dev/local-test-tools-runtime";
import type { CreateImageTaskInput, GenerationMode } from "@/types/image";

const dailyFreeGrantAmount = 10;
const dailyFreeCreditCap = 30;

export const generationCreditCosts: Record<GenerationMode, number> = {
  t2i: 10,
  i2i: 15,
  inpaint: 20,
  outpaint: 30
};

export function getGenerationCreditCost(input: Pick<CreateImageTaskInput, "taskType" | "count">) {
  const unitCost = generationCreditCosts[input.taskType];
  const multiplier = input.taskType === "t2i" || input.taskType === "i2i" ? input.count || 1 : 1;
  return unitCost * multiplier;
}

export class CreditBalanceError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  readonly status = 402;

  constructor(message: string) {
    super(message);
    this.name = "CreditBalanceError";
  }
}

function iso(date: Date) {
  return date.toISOString();
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function endOfUtcDay(date = new Date()) {
  return new Date(`${dayKey(date)}T23:59:59.999Z`);
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function allowedTestUsernames() {
  const configured = process.env.FLUXART_TEST_TOOLS_ALLOWED_USERNAMES;
  const usernames = configured ? configured.split(",") : ["tongsr"];
  return new Set(usernames.map(normalizeUsername).filter(Boolean));
}

async function topUpTestAccountIfNeeded(userId: string, requiredCredits: number, availableCredits: number) {
  if (!localTestToolsEnabled() || availableCredits >= requiredCredits) return undefined;

  const repositories = getRepositories();
  const account = await repositories.account.getCurrentAccount(userId);
  const username = normalizeUsername(account.username || "");
  if (!allowedTestUsernames().has(username)) return undefined;

  const amount = requiredCredits - availableCredits;
  const now = iso(new Date());
  await repositories.credits.createAdjustment({
    userId,
    amount,
    now,
    label: "Test Auto Credit Top-up",
    sourceRefId: `test-auto-top-up-${randomUUID()}`
  });
  return repositories.account.getCurrentAccount(userId);
}

export async function grantDailyFreeCreditsIfNeeded(userId: string) {
  const repositories = getRepositories();
  const account = await repositories.account.getCurrentAccount(userId);
  if (account.memberStatus !== "free") return undefined;

  const currentDay = dayKey();
  const current = iso(new Date());
  const ledgerEntries = await repositories.credits.listLedgerEntries(userId, 100);
  const todayDailyGrantTotal = ledgerEntries
    .filter(entry => entry.sourceRefType === "daily_free" && entry.sourceRefId === currentDay && entry.entryType === "grant")
    .reduce((sum, entry) => sum + entry.amount, 0);
  if (todayDailyGrantTotal >= dailyFreeGrantAmount) return undefined;

  const buckets = await repositories.credits.listBuckets(userId);
  const activeDailyFreeTotal = buckets
    .filter(bucket => bucket.sourceType === "daily_free" && bucket.remainingAmount > 0 && bucket.validFrom <= current && (!bucket.validUntil || bucket.validUntil > current))
    .reduce((sum, bucket) => sum + bucket.remainingAmount, 0);
  const grantAmount = Math.min(dailyFreeGrantAmount, dailyFreeCreditCap - activeDailyFreeTotal);
  if (grantAmount <= 0) return undefined;

  const nowDate = new Date();
  const now = iso(nowDate);
  const bucket = {
    id: `bucket-daily-${userId}-${currentDay}`,
    userId,
    sourceType: "daily_free",
    creditType: "promotional",
    originalAmount: grantAmount,
    remainingAmount: grantAmount,
    validFrom: now,
    validUntil: iso(endOfUtcDay(addDays(nowDate, 2))),
    priority: 5,
    createdAt: now,
    updatedAt: now
  } as const;

  const balanceAfter = account.credits + grantAmount;
  const ledgerEntry = {
    id: `ledger-daily-${userId}-${currentDay}`,
    userId,
    bucketId: bucket.id,
    entryType: "grant",
    amount: grantAmount,
    balanceAfter,
    sourceRefType: "daily_free",
    sourceRefId: currentDay,
    label: "Daily Free Credit Grant",
    createdAt: now
  } as const;

  return repositories.credits.createDailyFreeGrant({ bucket, ledgerEntry });
}

export async function getAvailableCredits(userId: string) {
  await grantDailyFreeCreditsIfNeeded(userId);
  return getRepositories().account.getCurrentAccount(userId);
}

export async function assertSufficientCreditsForGeneration(userId: string, input: Pick<CreateImageTaskInput, "taskType" | "count">) {
  const account = await getAvailableCredits(userId);
  const requiredCredits = getGenerationCreditCost(input);
  const fundedAccount = await topUpTestAccountIfNeeded(userId, requiredCredits, account.credits);
  if (!fundedAccount && account.credits < requiredCredits) {
    throw new CreditBalanceError(`insufficient credits: ${requiredCredits} required, ${account.credits} available`);
  }
  return { account: fundedAccount || account, requiredCredits };
}

export async function reserveCreditsForGeneration(userId: string, input: Pick<CreateImageTaskInput, "taskType" | "count"> & { taskId: string }) {
  const { account, requiredCredits } = await assertSufficientCreditsForGeneration(userId, input);
  const now = new Date();
  const reservation = await getRepositories().credits.reserveCredits({
    userId,
    amount: requiredCredits,
    holdId: `hold-${randomUUID()}`,
    taskId: input.taskId,
    label: "Generation Credit Hold",
    now: iso(now),
    expiresAt: iso(new Date(now.getTime() + 30 * 60 * 1000))
  });

  return { account, requiredCredits, hold: reservation.hold, ledgerEntries: reservation.ledgerEntries };
}

export async function spendCreditsForDownload(userId: string, input: { downloadId: string; amount: number }) {
  const account = await getAvailableCredits(userId);
  const fundedAccount = await topUpTestAccountIfNeeded(userId, input.amount, account.credits);
  if (!fundedAccount && account.credits < input.amount) {
    throw new CreditBalanceError(`insufficient credits: ${input.amount} required, ${account.credits} available`);
  }

  const now = new Date();
  const reservation = await getRepositories().credits.reserveCredits({
    userId,
    amount: input.amount,
    holdId: `hold-${randomUUID()}`,
    downloadId: input.downloadId,
    label: "Download Credit Hold",
    now: iso(now),
    expiresAt: iso(new Date(now.getTime() + 30 * 60 * 1000))
  });
  const spend = await finalizeCreditHoldSpend(reservation.hold.id, "Download Credit Spend");

  return { account: fundedAccount || account, hold: reservation.hold, holdLedgerEntries: reservation.ledgerEntries, spendLedgerEntries: spend?.ledgerEntries || [] };
}

export async function releaseCreditHold(holdId: string, label = "Credit Hold Released") {
  return getRepositories().credits.releaseHold({
    holdId,
    now: iso(new Date()),
    label
  });
}

export async function finalizeCreditHoldSpend(holdId: string, label = "Generation Credit Spend") {
  return getRepositories().credits.finalizeHoldSpend({
    holdId,
    now: iso(new Date()),
    label
  });
}

export async function settleCreditHoldPartially(holdId: string, spendAmount: number) {
  return getRepositories().credits.settleHoldPartially({
    holdId,
    spendAmount,
    now: iso(new Date()),
    spendLabel: "Generation Credit Spend",
    releaseLabel: "Generation Credit Hold Released"
  });
}

export async function refundCreditHold(holdId: string, label = "Generation Credit Refund") {
  return getRepositories().credits.refundHold({
    holdId,
    now: iso(new Date()),
    label
  });
}

export async function createCreditAdjustment(userId: string, amount: number, label = "Manual Credit Adjustment", sourceRefId?: string) {
  return getRepositories().credits.createAdjustment({
    userId,
    amount,
    label,
    sourceRefId,
    now: iso(new Date())
  });
}
