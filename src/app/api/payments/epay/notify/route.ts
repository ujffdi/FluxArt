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

async function handleNotifyPayload(payload: URLSearchParams | Record<string, unknown>) {
  try {
    await handleEpayPaymentNotify(payload);
    return new Response("success", { status: 200 });
  } catch (error) {
    if (error instanceof PaymentNotificationError) {
      return new Response(error.code, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "EPAY_NOTIFY_FAILED";
    return new Response(message, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleNotifyPayload(new URL(request.url).searchParams);
}

export async function POST(request: Request) {
  return handleNotifyPayload(await readNotifyPayload(request));
}
