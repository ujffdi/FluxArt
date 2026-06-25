# Wire production account, billing, and workspace UI

## What to build

Connect the existing account, billing, image workspace, asset history, edit route, and download flows to the production APIs while preserving the current visual direction.

## Acceptance criteria

- [ ] The workspace no longer depends on the front-end session simulation for production mode.
- [ ] Account pages show real session-backed identity, credit balance, membership state, and entitlement details.
- [ ] Billing pages show real credit pack and Pro purchase states.
- [ ] Image workspace task creation shows permission, credit, queue, and task-state errors clearly.
- [ ] Asset history uses server-side retention, soft deletion, and public MinIO URLs.
- [ ] Download actions enforce HD, watermark, Pro, and credit rules.
- [ ] Browser verification covers `/workspace/image`, `/workspace/image/edit/[assetId]`, `/workspace/image/assets`, `/workspace/account`, and `/workspace/billing`.

## Blocked by

- `06-provider-runner-output-review-and-assets.md`
- `08-pro-membership-entitlements-and-downloads.md`
