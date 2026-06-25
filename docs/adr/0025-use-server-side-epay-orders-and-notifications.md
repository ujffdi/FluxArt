# Use server-side Epay orders and notifications

FluxArt V1 can integrate with an existing Epay or Alipay QR payment system, but payment configuration and signing must stay on the server. The server creates a local Order and outTradeNo, calls a Payment Provider Adapter to create the payment request, and treats the provider notify callback as the source of truth. Return page redirects are only UI hints. Notifications must verify signature, amount, merchant id, order id, and status, and must be idempotent.
