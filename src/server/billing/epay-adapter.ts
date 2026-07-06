import { createHash } from "node:crypto";

type EpayParams = Record<string, string>;

function configuredMerchantId() {
  return process.env.MAPAY_MERCHANT_ID || process.env.MAPAY_PID || process.env.EPAY_MERCHANT_ID || process.env.EPAY_PID || "mock-merchant";
}

function configuredSecret() {
  return process.env.MAPAY_SIGNING_SECRET || process.env.MAPAY_SECRET || process.env.MAPAY_KEY || process.env.EPAY_SIGNING_SECRET || process.env.EPAY_SECRET || process.env.EPAY_KEY || "mock-epay-secret";
}

function configuredApiUrl() {
  return process.env.MAPAY_API_URL || process.env.EPAY_API_URL || "";
}

function sortedQuery(params: EpayParams) {
  return Object.entries(params)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function formatEpayAmount(amountCents: number) {
  return (amountCents / 100).toFixed(2);
}

export function signEpayParams(params: EpayParams, secret = configuredSecret()) {
  return createHash("md5").update(`${sortedQuery(params)}${secret}`).digest("hex");
}

export function verifyEpaySignature(params: EpayParams) {
  return params.sign === signEpayParams(params);
}

export function createEpayPaymentUrl(input: { outTradeNo: string; amountCents: number; planName: string }) {
  const params: EpayParams = {
    pid: configuredMerchantId(),
    type: "alipay",
    out_trade_no: input.outTradeNo,
    name: input.planName,
    money: formatEpayAmount(input.amountCents),
    notify_url: process.env.MAPAY_NOTIFY_URL || process.env.EPAY_NOTIFY_URL || "http://127.0.0.1:3107/api/payments/mapay/notify",
    return_url: process.env.MAPAY_RETURN_URL || process.env.EPAY_RETURN_URL || "http://127.0.0.1:3107/api/payments/mapay/return"
  };
  const sign = signEpayParams(params);
  const query = new URLSearchParams({ ...params, sign, sign_type: "MD5" }).toString();
  const apiUrl = configuredApiUrl();
  return apiUrl ? `${apiUrl.replace(/\/+$/, "")}/submit.php?${query}` : `/workspace/billing?outTradeNo=${encodeURIComponent(input.outTradeNo)}&mockPayment=epay`;
}

export function readEpayNotifyParams(input: URLSearchParams | Record<string, unknown>): EpayParams {
  const entries = input instanceof URLSearchParams ? [...input.entries()] : Object.entries(input).map(([key, value]) => [key, String(value ?? "")] as const);
  return Object.fromEntries(entries.filter(([key]) => key)) as EpayParams;
}

export function epayMerchantId() {
  return configuredMerchantId();
}
