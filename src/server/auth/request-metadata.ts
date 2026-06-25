export function getRequestUserAgent(request: Request) {
  return request.headers.get("user-agent") || undefined;
}

export function getTrustedClientIp(request: Request) {
  if (process.env.FLUXART_TRUST_PROXY_HEADERS !== "1") return undefined;
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") || forwardedFor || undefined;
}
