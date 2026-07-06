# Enforce one-month validity for new Credit Buckets

Status: ready-for-agent

## Parent

[PRD: Model selection and one-month credit validity](../PRD.md)

## What to build

Make all newly created Credit Buckets use a one-month Credit Validity Window while preserving existing Credit Buckets exactly as they are. This slice should cover the complete user-visible balance path for Registration Credit Grants, Daily Free Credit Grants, and Purchased Credits from fulfilled Credit Pack orders.

The behavior should be visible through account credit summaries and billing/order fulfillment behavior: new credits expire one month after they are granted or purchased, while historical buckets are not retroactively shortened.

## Acceptance criteria

- [ ] New Registration Credit Grants receive a one-month `validUntil`.
- [ ] New Daily Free Credit Grants receive a one-month `validUntil`.
- [ ] New Purchased Credits from fulfilled Credit Pack orders receive a one-month `validUntil`.
- [ ] Existing Credit Buckets are not migrated, rewritten, or shortened by this slice.
- [ ] Account credit summaries continue to show only currently valid and unspent Credit Buckets.
- [ ] Credit spend priority continues to prefer expiring Promotional Credits before Purchased Credits.
- [ ] API or smoke validation covers the new validity window for registration, daily free, and purchased credits.

## Blocked by

None - can start immediately
