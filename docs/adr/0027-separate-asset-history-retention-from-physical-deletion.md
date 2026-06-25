# Separate asset history retention from physical deletion

FluxArt V1 will separate visible asset history from physical object deletion. Free Users keep visible history for 7 days or 20 assets, whichever is stricter. Credit Pack Users and Pro Members keep paid-generated assets long-lived in V1. User deletion sets deletedAt first, while MinIO object cleanup can run asynchronously later. Billing, ledger, order, and image task records remain available for audit.
