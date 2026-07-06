import { NextResponse } from "next/server";
import { handleEpayPaymentNotify, PaymentNotificationError } from "@/server/billing/billing-service";

function billingReturnTarget(request: Request) {
  const configured = process.env.MAPAY_RETURN_URL || process.env.EPAY_RETURN_URL;
  if (!configured) return new URL("/workspace/billing", request.url);

  const target = new URL(configured, request.url);
  if (target.pathname.includes("/api/payments/")) {
    return new URL("/workspace/billing", target.origin);
  }

  return target;
}

async function readReturnPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json() as Promise<Record<string, unknown>>;
  }
  return request.formData().then(formData => {
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      params.set(key, String(value));
    }
    return params;
  }).catch(() => request.text().then(text => new URLSearchParams(text)));
}

async function handleReturnPayload(request: Request, payload: URLSearchParams | Record<string, unknown>) {
  const target = billingReturnTarget(request);

  try {
    await handleEpayPaymentNotify(payload);
    target.searchParams.set("payment", "success");
  } catch (error) {
    target.searchParams.set("payment", "failed");
    target.searchParams.set("error", error instanceof PaymentNotificationError ? error.code : "EPAY_RETURN_FAILED");
  }

  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  return handleReturnPayload(request, new URL(request.url).searchParams);
}

export async function POST(request: Request) {
  return handleReturnPayload(request, await readReturnPayload(request));
}
