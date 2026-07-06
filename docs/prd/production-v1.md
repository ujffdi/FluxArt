# FluxArt Production V1 PRD

## Problem Statement

FluxArt currently has a polished Next.js App Router product surface with mock repository data and mock-first image generation. It is not yet a production product because user identity, persistent credit accounting, paid order fulfillment, MinIO-backed asset storage, provider execution, and payment notifications are not backed by durable infrastructure.

The next production slice must turn the mock product into a real online AI image generation service while preserving the current UI direction and API boundaries.

## Solution

Build FluxArt Production V1 on the current Next.js, React, and TypeScript app. Replace the in-memory repository with a Prisma adapter backed by MySQL, add self-declared username/password accounts, implement server-side sessions, make credits ledger-backed, store source and generated images in a public MinIO bucket, run image generation through a replaceable provider runner, and fulfill credit packs from verified Epay payment notifications.

The default image provider remains OpenAI `gpt-image-2`, with support for custom OpenAI-compatible image providers and future asynchronous providers.

## User Stories

1. As a new user, I want to register with a username and password, so that I can use FluxArt without phone or email verification.
2. As a returning user, I want to log in with my username and password, so that I can access my workspace.
3. As a user, I want my login session to persist safely, so that I do not need to log in every time I open the app.
4. As a user, I want password changes to clear old sessions, so that compromised sessions stop working.
5. As a new user, I want to receive registration credits, so that I can try image generation immediately.
6. As a Free User, I want daily free credits to appear when I use the product, so that I can keep lightly testing FluxArt.
7. As a Free User, I want clear limits on generation and history, so that I understand why I may need purchased credits.
8. As a Credit Pack User, I want to buy fixed credit packs, so that I can pay for occasional generation work.
9. As a user, I want credits held before generation and refunded when no usable output is delivered, so that failed tasks do not consume balance unfairly.
10. As a user, I want image tasks to show stable task states, so that I know whether a generation is queued, running, storing, reviewing, succeeded, failed, or refunded.
11. As a user, I want source images and masks uploaded safely, so that editing and outpainting work without corrupt inputs.
12. As a user, I want generated assets stored reliably, so that my history and downloads do not depend on server memory.
13. As an operator, I want image providers abstracted behind one runner, so that OpenAI can be the default while other providers remain possible.
14. As an operator, I want synchronous and asynchronous providers normalized, so that vendor-specific response shapes do not leak into product logic.
15. As an operator, I want payment callbacks to be verified and idempotent, so that credits are not double-granted.
16. As an operator, I want order fulfillment failures to be retryable, so that paid users can be made whole without manual database edits.
17. As an operator, I want immutable credit and payment ledgers, so that billing support and reconciliation are possible.
18. As an operator, I want public MinIO URLs with non-guessable keys, so that V1 delivery is simple without making assets easy to enumerate.
19. As an operator, I want environment validation for MySQL, MinIO, OpenAI, custom providers, and Epay, so that deployment misconfiguration is caught early.

## Implementation Decisions

- Keep the app on Next.js App Router, React, and TypeScript.
- Keep secure operations in server modules and route handlers. Client components call typed client APIs rather than direct provider, MinIO, or payment APIs.
- Replace the in-memory repository behind the data access boundary with a Prisma/MySQL implementation instead of changing page-level contracts.
- Use self-declared username/password accounts. Do not require phone or email in V1.
- Store password hashes server-side using a modern password hash. Argon2id is preferred; bcrypt is acceptable if deployment constraints make Argon2 difficult.
- Use httpOnly cookie sessions with sameSite=lax, secure cookies in production, 30-day sliding renewal, 90-day absolute expiry, and a five-session active limit.
- Grant 50 Promotional Credits at registration.
- Grant 10 Daily Free Credits lazily when a Free User first checks balance or starts task creation that day, capped at 30 Daily Free Credits.
- Use Credit Buckets and immutable Credit Ledger Entries for all grants, spends, refunds, holds, and adjustments.
- Spend expiring Promotional Credits first, then Purchased Credits.
- Hold credits before creating an image task. Convert the hold to final spend only when a Usable Output is approved. Release or refund the hold for system failures or output review failures.
- Use fixed V1 costs: Text-to-Image 10 credits per image, Image-to-Image 15 credits per image, Inpainting 20 credits per edit, Outpainting 30 credits per edit, HD no-watermark download 5 credits.
- Offer three long-lived credit packs: 500 credits for CNY 29, 1500 credits for CNY 79, and 5000 credits for CNY 199.
- Use a compact task state machine: queued, running, storing, reviewing, succeeded, failed, refunded.
- Use a replaceable Image Task Runner seam. V1 may execute from the Next.js server process, but task state, priority, and provider abstractions must allow migration to BullMQ, cloud tasks, or a standalone worker.
- Normalize synchronous and asynchronous image providers into Provider Submission and Provider Result records.
- Default to provider `openai` and model `gpt-image-2`, while supporting custom OpenAI-compatible image providers.
- Use a public MinIO bucket. Object keys must include UUID or ULID identifiers and should not depend on sequential ids for secrecy.
- Store `objectKey`, `publicUrl`, MIME type, size, width, and height for each upload or asset.
- Enforce upload constraints server-side: JPEG, PNG, and WebP source images up to 10MB with maximum edge 4096px; PNG/WebP masks normalized when needed.
- Review generated output before final credit spend. Initial V1 review can be lightweight but must preserve review status for later moderation.
- Use server-side Epay integration. The server creates local orders and treats provider notify callbacks as the source of truth.
- Make payment notifications signature-verified, amount-verified, merchant-verified, status-verified, and idempotent.
- Fulfill paid orders transactionally. Credit pack orders create Purchased Credit Buckets and Credit Ledger Entries.
- Separate visible asset history from physical object deletion. Free Users keep visible history for 7 days or 20 assets, whichever is stricter. Paid assets are long-lived in V1.

### Prisma/MySQL Table Design

V1 should model these durable records:

- `User`: account identity, display name, status, timestamps.
- `UserCredential`: username, password hash, hash version, password changed timestamp.
- `UserSession`: hashed session token, sliding expiry, absolute expiry, revoked timestamp, user agent and IP metadata.
- `CreditBucket`: user, source type, credit type, original amount, remaining amount, validity window, priority, and optional source order.
- `CreditLedgerEntry`: immutable grant, hold, spend, refund, release, adjustment records with balance deltas and source references.
- `CreditHold`: task or download reservation, held amount, status, expiry, converted or refunded timestamps.
- `CreditPackSku`: package code, display name, credit amount, price, active flag.
- `Order`: user, SKU or plan, amount, currency, provider, outTradeNo, status, fulfillment status.
- `PaymentNotification`: order, provider trade number, verified status, raw payload digest, received timestamp, processed timestamp.
- `ImageUpload`: user-owned uploaded source or mask, object key, public URL, MIME type, size, dimensions, validation status.
- `ImageTask`: user, task type, prompt, model/provider, state, priority, cost, queued/running/storing/review timestamps, failure reason.
- `ProviderSubmission`: task, provider, model, provider mode, request metadata, external task id.
- `ProviderResult`: submission, normalized result status, raw payload digest, output metadata, error metadata.
- `ImageAsset`: task and user, object key, public URL, dimensions, review status, watermark/HD flags, entitlement snapshot, deletion timestamp.
- `DownloadEvent`: asset, user, download type, credit cost, timestamp.
- `AssetCleanupJob`: optional deferred physical MinIO cleanup for soft-deleted or retention-expired assets.

## Testing Decisions

- Prefer tests at behavior seams: route handlers, server services, repository adapter contracts, and browser smoke flows.
- Repository tests should prove Prisma adapter behavior matches the current repository contract rather than testing Prisma internals.
- Auth tests should cover registration, login, session renewal, active session limit, logout, and password-change revocation.
- Credit tests should cover registration grants, lazy daily grants, spend priority, holds, final spend, refunds, and insufficient-balance failures.
- Payment tests should cover Epay signing, notify verification, duplicate callbacks, wrong amount, wrong merchant, and fulfillment retry.
- Image tests should cover upload validation, task state transitions, provider success/failure, MinIO writes, output review, and asset creation.
- Browser verification should cover `/workspace/image`, `/workspace/image/edit/[assetId]`, `/workspace/image/assets`, `/workspace/account`, and `/workspace/billing`.
- Build gates should include typecheck, lint, build, environment validation, and API smoke checks.

## Out of Scope

- Phone verification, email verification, OAuth login, SSO, and enterprise accounts.
- Full legal commercial license drafting.
- Redis, BullMQ, or a dedicated worker deployment as a hard V1 requirement.
- Private MinIO buckets and signed URLs.
- Full manual moderation tooling.
- Refunds back to the external payment method.

## Further Notes

- The existing UI should be preserved and wired to real production APIs incrementally.
- Local development should continue to support mock or degraded mode where possible, but production paths must be explicit and environment-validated.
- The ADR files in `docs/adr/` are the source of truth for detailed tradeoffs behind this PRD.
