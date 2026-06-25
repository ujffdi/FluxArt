# Refund held credits when no usable output is delivered

FluxArt will not finalize credit spend unless an image task delivers usable output. System Failures and Output Review Failures release or refund the Credit Hold in V1, while validation, permission, and insufficient-credit failures happen before task creation and do not create a hold.
