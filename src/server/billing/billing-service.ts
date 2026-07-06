import { createHash, randomUUID } from "node:crypto";
import { createEpayPaymentUrl, epayMerchantId, readEpayNotifyParams, verifyEpaySignature } from "@/server/billing/epay-adapter";
import { billingPlans } from "@/server/billing/plans";
import { getRepositories } from "@/server/data/repositories";
import type { BillingOrder, BillingPlanId } from "@/types/billing";

export class PaymentNotificationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "PaymentNotificationError";
    this.code = code;
    this.status = status;
  }
}

export async function createMockOrder(planId: BillingPlanId, userId?: string) {
  const repositories = getRepositories();
  const account = await repositories.account.getCurrentAccount(userId);
  const plan = billingPlans[planId];
  const order = await repositories.billing.createOrder({
    planId,
    userId: account.userId,
    creditsAfterPayment: account.credits + (plan.kind === "credit_pack" ? plan.credits : 0),
    memberStatusAfterPayment: planId === "pro-monthly" ? "pro" : account.memberStatus
  });
  const paymentUrl = createEpayPaymentUrl({
    outTradeNo: order.outTradeNo || order.orderId,
    amountCents: plan.amountCents,
    planName: plan.displayName
  });
  await repositories.billing.updateOrder(order.orderId, { paymentUrl });

  return { ...order, paymentUrl };
}

export async function listBillingOrders(userId: string): Promise<BillingOrder[]> {
  const repositories = getRepositories();
  const [account, orders] = await Promise.all([
    repositories.account.getCurrentAccount(userId),
    repositories.billing.listOrders(userId)
  ]);

  return orders.map(order => {
    const plan = billingPlans[order.planId];
    return {
      orderId: order.id,
      planId: order.planId,
      userId: order.userId,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      outTradeNo: order.outTradeNo,
      amountCents: order.amountCents,
      currency: order.currency,
      paymentUrl: order.paymentUrl,
      creditsAfterPayment: account.credits + (plan.kind === "credit_pack" && order.fulfillmentStatus !== "fulfilled" ? plan.credits : 0),
      memberStatusAfterPayment: plan.kind === "membership" && order.fulfillmentStatus !== "fulfilled" ? "pro" : account.memberStatus,
      createdAt: order.createdAt
    };
  });
}

function stableDigest(params: Record<string, string>) {
  const stable = Object.entries(params).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function iso(date = new Date()) {
  return date.toISOString();
}

function epayAmountMatches(receivedAmount: string | undefined, expectedAmountCents: number) {
  if (!receivedAmount) return false;
  const normalized = Number(receivedAmount);
  if (!Number.isFinite(normalized)) return false;
  return Math.round(normalized * 100) === expectedAmountCents;
}

function addOneMonth(date: Date) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function toOrder(planOrder: Awaited<ReturnType<ReturnType<typeof getRepositories>["billing"]["getOrderByOutTradeNo"]>>) {
  if (!planOrder) return undefined;
  return planOrder;
}

async function readVerifiedEpayOrder(input: URLSearchParams | Record<string, unknown>) {
  const params = readEpayNotifyParams(input);
  const outTradeNo = params.out_trade_no;
  const receivedAt = iso();
  const rawPayloadDigest = stableDigest(params);
  const repositories = getRepositories();

  if (!verifyEpaySignature(params)) {
    throw new PaymentNotificationError("invalid Epay signature", "EPAY_SIGNATURE_INVALID");
  }
  if (params.pid !== epayMerchantId()) {
    throw new PaymentNotificationError("invalid Epay merchant id", "EPAY_MERCHANT_INVALID");
  }
  if (!outTradeNo) {
    throw new PaymentNotificationError("out_trade_no is required", "EPAY_ORDER_REQUIRED");
  }
  if (params.trade_status !== "TRADE_SUCCESS") {
    throw new PaymentNotificationError("Epay status is not successful", "EPAY_STATUS_UNSUCCESSFUL");
  }

  const order = toOrder(await repositories.billing.getOrderByOutTradeNo(outTradeNo));
  if (!order) {
    throw new PaymentNotificationError("local order was not found", "ORDER_NOT_FOUND", 404);
  }
  const plan = billingPlans[order.planId];
  if (!epayAmountMatches(params.money, order.amountCents)) {
    await repositories.billing.updateOrder(order.id, { fulfillmentStatus: "retryable" });
    throw new PaymentNotificationError("Epay amount does not match local order", "EPAY_AMOUNT_MISMATCH");
  }

  return { repositories, params, order, plan, receivedAt, rawPayloadDigest };
}

export async function handleEpayCreditPackNotify(input: URLSearchParams | Record<string, unknown>) {
  const { repositories, params, order, plan, receivedAt, rawPayloadDigest } = await readVerifiedEpayOrder(input);
  const providerTradeNo = params.trade_no;

  if (plan.kind !== "credit_pack") {
    await repositories.billing.updateOrder(order.id, { fulfillmentStatus: "retryable" });
    throw new PaymentNotificationError("order is not a credit pack", "ORDER_PLAN_UNSUPPORTED");
  }

  const now = iso();
  const existingNotification = await repositories.billing.getPaymentNotificationByDigest(order.id, rawPayloadDigest);
  if (existingNotification || order.fulfillmentStatus === "fulfilled") {
    return { ok: true, duplicated: true, order };
  }

  const currentAccount = await repositories.account.getCurrentAccount(order.userId);
  const bucket = {
    id: `bucket-${randomUUID()}`,
    userId: order.userId,
    sourceType: "purchased" as const,
    creditType: "purchased" as const,
    originalAmount: plan.credits,
    remainingAmount: plan.credits,
    validFrom: now,
    validUntil: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString(),
    priority: 90,
    sourceOrderId: order.id,
    createdAt: now,
    updatedAt: now
  };
  const ledgerEntry = {
    id: `ledger-${randomUUID()}`,
    userId: order.userId,
    bucketId: bucket.id,
    entryType: "grant" as const,
    amount: plan.credits,
    balanceAfter: currentAccount.credits + plan.credits,
    sourceRefType: "credit_pack_order",
    sourceRefId: order.id,
    label: "Purchased Credit Pack",
    createdAt: now
  };
  const notification = {
    id: `notification-${randomUUID()}`,
    orderId: order.id,
    providerTradeNo,
    verified: true,
    rawPayloadDigest,
    receivedAt,
    processedAt: now
  };

  try {
    const fulfilled = await repositories.billing.fulfillCreditPackOrder({ order, notification, bucket, ledgerEntry, paidAt: now });
    return { ok: true, duplicated: fulfilled.duplicated, order: fulfilled.order, bucket: fulfilled.bucket, ledgerEntry: fulfilled.ledgerEntry };
  } catch (error) {
    await repositories.billing.updateOrder(order.id, { fulfillmentStatus: "retryable" });
    throw error;
  }
}

export async function handleEpayMembershipNotify(input: URLSearchParams | Record<string, unknown>) {
  const { repositories, params, order, plan, receivedAt, rawPayloadDigest } = await readVerifiedEpayOrder(input);
  const providerTradeNo = params.trade_no;

  if (plan.kind !== "membership") {
    await repositories.billing.updateOrder(order.id, { fulfillmentStatus: "retryable" });
    throw new PaymentNotificationError("order is not a membership plan", "ORDER_PLAN_UNSUPPORTED");
  }

  const now = iso();
  const existingNotification = await repositories.billing.getPaymentNotificationByDigest(order.id, rawPayloadDigest);
  if (existingNotification || order.fulfillmentStatus === "fulfilled") {
    return { ok: true, duplicated: true, order };
  }

  const cycles = await repositories.billing.listMembershipCycles(order.userId);
  const nowDate = new Date(now);
  const latestActiveCycle = cycles
    .filter(cycle => cycle.status === "active" && Date.parse(cycle.cycleEnd) > nowDate.getTime())
    .sort((left, right) => Date.parse(right.cycleEnd) - Date.parse(left.cycleEnd))[0];
  const cycleStartDate = latestActiveCycle ? new Date(latestActiveCycle.cycleEnd) : nowDate;
  const cycleEndDate = addOneMonth(cycleStartDate);
  const cycle = {
    id: `cycle-${randomUUID()}`,
    userId: order.userId,
    planCode: "pro-monthly" as const,
    orderId: order.id,
    cycleStart: cycleStartDate.toISOString(),
    cycleEnd: cycleEndDate.toISOString(),
    status: "active" as const,
    hdDownloadsUsed: 0,
    hdFairUseCap: 300,
    createdAt: now,
    updatedAt: now
  };
  const currentAccount = await repositories.account.getCurrentAccount(order.userId);
  const bucket = {
    id: `bucket-${randomUUID()}`,
    userId: order.userId,
    sourceType: "membership" as const,
    creditType: "promotional" as const,
    originalAmount: plan.credits,
    remainingAmount: plan.credits,
    validFrom: cycle.cycleStart,
    validUntil: cycle.cycleEnd,
    priority: 20,
    sourceOrderId: order.id,
    membershipCycleId: cycle.id,
    createdAt: now,
    updatedAt: now
  };
  const ledgerEntry = {
    id: `ledger-${randomUUID()}`,
    userId: order.userId,
    bucketId: bucket.id,
    entryType: "grant" as const,
    amount: plan.credits,
    balanceAfter: currentAccount.credits + (bucket.validFrom <= now ? plan.credits : 0),
    sourceRefType: "membership_order",
    sourceRefId: order.id,
    label: "Pro Membership Monthly Credit Grant",
    createdAt: now
  };
  const notification = {
    id: `notification-${randomUUID()}`,
    orderId: order.id,
    providerTradeNo,
    verified: true,
    rawPayloadDigest,
    receivedAt,
    processedAt: now
  };

  try {
    const fulfilled = await repositories.billing.fulfillMembershipOrder({ order, notification, cycle, bucket, ledgerEntry, paidAt: now });
    return { ok: true, duplicated: fulfilled.duplicated, order: fulfilled.order, cycle: fulfilled.cycle, bucket: fulfilled.bucket, ledgerEntry: fulfilled.ledgerEntry };
  } catch (error) {
    await repositories.billing.updateOrder(order.id, { fulfillmentStatus: "retryable" });
    throw error;
  }
}

export async function handleEpayPaymentNotify(input: URLSearchParams | Record<string, unknown>) {
  const params = readEpayNotifyParams(input);
  const order = params.out_trade_no ? await getRepositories().billing.getOrderByOutTradeNo(params.out_trade_no) : undefined;
  if (order && billingPlans[order.planId]?.kind === "membership") {
    return handleEpayMembershipNotify(params);
  }
  return handleEpayCreditPackNotify(params);
}
