# Add Epay credit pack orders

## What to build

Let users buy fixed credit packs through a server-side Epay-compatible payment adapter and grant Purchased Credits only from verified notify callbacks.

## Acceptance criteria

- [ ] The billing UI can start purchase flows for 500, 1500, and 5000 credit packs.
- [ ] The server creates local Orders and outTradeNo values before calling the payment adapter.
- [ ] Payment configuration and signing secrets stay server-side.
- [ ] Epay notify callbacks verify signature, amount, merchant id, order id, and status.
- [ ] Duplicate payment notifications are idempotent and do not duplicate credit grants.
- [ ] Successful credit pack orders transactionally create Purchased Credit Buckets and Credit Ledger Entries.
- [ ] Fulfillment failures remain visible and retryable.

## Blocked by

- `03-credit-ledger-free-grants-and-balance.md`
