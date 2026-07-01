export function localTestToolsEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.FLUXART_ENABLE_TEST_TOOLS === "1";
}

export function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
