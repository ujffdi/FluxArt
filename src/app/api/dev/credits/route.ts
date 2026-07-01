import { adjustTestAccountCredits, assertTestCreditToolAccess, TestCreditToolError } from "@/server/dev/test-credit-tools";
import { fail, ok } from "@/server/shared/api-response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalInteger(value: unknown) {
  return value === undefined || Number.isInteger(value);
}

export async function POST(request: Request) {
  try {
    assertTestCreditToolAccess(request);
  } catch (error) {
    if (error instanceof TestCreditToolError) return fail(error.message, error.status, error.code);
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("request body must be valid JSON", 400, "INVALID_JSON");
  }

  if (
    !isRecord(body)
    || typeof body.username !== "string"
    || !optionalInteger(body.amount)
    || !optionalInteger(body.targetCredits)
    || (body.label !== undefined && typeof body.label !== "string")
  ) {
    return fail("username and integer amount or targetCredits are required", 400, "TEST_CREDIT_INPUT_INVALID");
  }

  try {
    return ok({
      adjustment: await adjustTestAccountCredits({
        username: body.username,
        amount: body.amount as number | undefined,
        targetCredits: body.targetCredits as number | undefined,
        label: body.label
      })
    });
  } catch (error) {
    if (error instanceof TestCreditToolError) return fail(error.message, error.status, error.code);
    if (error instanceof Error && error.message === "INSUFFICIENT_CREDITS") {
      return fail("account does not have enough credits for this adjustment", 400, "TEST_CREDIT_INSUFFICIENT_BALANCE");
    }
    return fail("test credit adjustment failed", 500, "TEST_CREDIT_ADJUSTMENT_FAILED");
  }
}
