# Fulfill paid orders transactionally

FluxArt V1 will fulfill paid orders inside a server-side database transaction after a verified Payment Notification. Credit pack orders create Purchased Credit Buckets and Credit Ledger Entries. Replayed notifications must not duplicate grants, and fulfillment failures must remain retryable instead of silently marking credits as delivered.
