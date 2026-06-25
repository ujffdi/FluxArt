import { handleEpayPaymentNotify, PaymentNotificationError } from "@/server/billing/billing-service";

async function readNotifyPayload(request: Request) {
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

export async function POST(request: Request) {
  try {
    await handleEpayPaymentNotify(await readNotifyPayload(request));
    return new Response("success", { status: 200 });
  } catch (error) {
    if (error instanceof PaymentNotificationError) {
      return new Response(error.code, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "EPAY_NOTIFY_FAILED";
    return new Response(message, { status: 500 });
  }
}
