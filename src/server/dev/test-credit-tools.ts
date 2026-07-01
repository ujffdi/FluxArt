import { randomUUID, timingSafeEqual } from "node:crypto";
import { grantDailyFreeCreditsIfNeeded } from "@/server/credits/credit-service";
import { getRepositories } from "@/server/data/repositories";
import { isLocalRequest, localTestToolsEnabled } from "@/server/dev/local-test-tools-runtime";

export class TestCreditToolError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "TestCreditToolError";
    this.code = code;
    this.status = status;
  }
}

export interface AdjustTestAccountCreditsInput {
  username: string;
  amount?: number;
  targetCredits?: number;
  label?: string;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function allowedUsernames() {
  const configured = process.env.FLUXART_TEST_TOOLS_ALLOWED_USERNAMES;
  const usernames = configured ? configured.split(",") : ["tongsr"];
  return new Set(usernames.map(normalizeUsername).filter(Boolean));
}

function maxCreditDelta() {
  const configured = Number(process.env.FLUXART_TEST_TOOLS_MAX_CREDIT_DELTA || 100000);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 100000;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function assertTestCreditToolAccess(request: Request) {
  if (!localTestToolsEnabled()) {
    throw new TestCreditToolError("test tools are only available in local development", "TEST_TOOLS_LOCAL_ONLY", 403);
  }

  if (!isLocalRequest(request)) {
    throw new TestCreditToolError("test tools only accept local requests", "TEST_TOOLS_LOCAL_REQUEST_REQUIRED", 403);
  }

  const secret = process.env.FLUXART_TEST_TOOLS_SECRET;
  if (!secret) {
    throw new TestCreditToolError("test tools secret is not configured", "TEST_TOOLS_SECRET_MISSING", 503);
  }

  const authorization = request.headers.get("authorization") || "";
  const prefix = "Bearer ";
  const token = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : "";
  if (!token || !safeEqual(token, secret)) {
    throw new TestCreditToolError("invalid test tools token", "TEST_TOOLS_AUTH_INVALID", 401);
  }
}

export async function adjustTestAccountCredits(input: AdjustTestAccountCreditsInput) {
  const username = normalizeUsername(input.username);
  if (!allowedUsernames().has(username)) {
    throw new TestCreditToolError("account is not allowed for test credit tools", "TEST_ACCOUNT_NOT_ALLOWED", 403);
  }

  const amount = input.amount;
  const targetCredits = input.targetCredits;
  const hasAmount = amount !== undefined;
  const hasTargetCredits = targetCredits !== undefined;
  if (hasAmount === hasTargetCredits) {
    throw new TestCreditToolError("provide exactly one of amount or targetCredits", "TEST_CREDIT_INPUT_INVALID", 400);
  }

  if (hasAmount && (!Number.isInteger(amount) || amount === 0)) {
    throw new TestCreditToolError("amount must be a non-zero integer", "TEST_CREDIT_AMOUNT_INVALID", 400);
  }

  if (hasTargetCredits && (!Number.isInteger(targetCredits) || targetCredits < 0)) {
    throw new TestCreditToolError("targetCredits must be a non-negative integer", "TEST_CREDIT_TARGET_INVALID", 400);
  }

  const repositories = getRepositories();
  const user = await repositories.account.getUserByUsername(username);
  if (!user) {
    throw new TestCreditToolError("test account was not found", "TEST_ACCOUNT_NOT_FOUND", 404);
  }

  await grantDailyFreeCreditsIfNeeded(user.id);
  const before = await repositories.account.getCurrentAccount(user.id);
  const delta = hasAmount ? amount as number : (targetCredits as number) - before.credits;
  const maxDelta = maxCreditDelta();
  if (Math.abs(delta) > maxDelta) {
    throw new TestCreditToolError(`credit adjustment exceeds max delta ${maxDelta}`, "TEST_CREDIT_DELTA_TOO_LARGE", 400);
  }

  const now = new Date().toISOString();
  const label = input.label?.trim() || "Test Environment Credit Adjustment";
  const adjustment = delta === 0
    ? { ledgerEntries: [] }
    : await repositories.credits.createAdjustment({
      userId: user.id,
      amount: delta,
      now,
      label,
      sourceRefId: `test-credit-tool-${randomUUID()}`
    });
  const after = await repositories.account.getCurrentAccount(user.id);

  return {
    username,
    userId: user.id,
    beforeCredits: before.credits,
    delta,
    afterCredits: after.credits,
    ledgerEntries: adjustment.ledgerEntries
  };
}
