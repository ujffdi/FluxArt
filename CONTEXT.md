# FluxArt Product Context

FluxArt is an online AI image generation product. This context defines the product language for accounts, credits, memberships, image generation, downloads, and billing.

## Language

**Credit**:
A prepaid unit of consumption used to pay for image generation, image editing, outpainting, and some downloads.
_Avoid_: Token, coin, point

**Purchased Credit**:
Credit obtained through a paid credit package. Purchased Credits are intended to be long-lived and should not feel like a short-term trial entitlement.
_Avoid_: Paid point, cash credit

**Credit Validity Window**:
The time period during which a Credit Bucket can be spent. Purchased Credits should be long-lived in V1, either effectively long-term or valid for at least two years.
_Avoid_: Expiry rule

**Promotional Credit**:
Credit granted by registration, daily refresh, campaign, or membership benefits. Promotional Credits may have stricter validity, accumulation, and usage rules than Purchased Credits.
_Avoid_: Free point, bonus token

**Registration Credit Grant**:
A one-time Promotional Credit grant given when a user first creates an account.
_Avoid_: Signup bonus

**Registration Grant Ledger Entry**:
The Credit Ledger Entry created when a new Self-Declared Account receives its Registration Credit Grant.
_Avoid_: Signup grant log

**Daily Free Credit Grant**:
A small recurring Promotional Credit grant refreshed daily for Free Users. It exists to support lightweight trial usage, not sustained production work.
_Avoid_: Daily salary, daily balance

**Lazy Daily Credit Grant**:
A Daily Free Credit Grant issued only when an active user first needs account balance or task creation on a given day.
_Avoid_: Scheduled daily grant

**Daily Free Credit Cap**:
The maximum amount of Daily Free Credit Grant balance that can accumulate. V1 caps daily free credit accumulation at 30 credits.
_Avoid_: Free balance limit

**Credit Bucket**:
A separately tracked group of credits with a source, validity window, and consumption priority.
_Avoid_: Balance row, wallet item

**Credit Ledger Entry**:
An immutable record of a credit grant, spend, refund, or adjustment. It is the audit trail for how a user's credit balance changed.
_Avoid_: Balance log, point history

**Credit Hold**:
A temporary reservation of credits made before an image task starts. A Credit Hold becomes final spend when the task succeeds and is released or refunded when the task fails before delivering usable output.
_Avoid_: Freeze, precharge

**Usable Output**:
An image task result that passes output review and can be shown to the user as an asset.
_Avoid_: Generated result, model output

**Output Review Status**:
The review outcome for a generated image before it becomes user-visible. V1 uses pending, approved, rejected, and skipped to leave room for later provider moderation or manual review.
_Avoid_: Audit flag

**Skipped Output Review**:
The review status for an asset that did not come from a provider output and therefore does not enter generated-output review. User Uploaded Assets use this status after passing Upload Constraints.
_Avoid_: Approved upload, unchecked generated output

**System Failure**:
A task failure caused by provider errors, timeout, storage failure, or server-side exceptions after credits have been held.
_Avoid_: Technical failure

**Output Review Failure**:
A task failure where the model produced an image but the result did not pass review and is not delivered as a usable asset.
_Avoid_: Moderation failure, blocked output

**Image Task Runner**:
The component that executes queued image tasks by calling the selected provider, storing outputs, creating assets, and updating task state.
_Avoid_: Worker when the deployment mechanism is not fixed

**Running Task Limit**:
The maximum number of image tasks a user can have running at the same time. V1 allows 1 for Free Users, 2 for Credit Pack Users, and 4 for Pro Members.
_Avoid_: Rate limit

**Task Priority**:
The numeric priority stored on an image task for queue ordering. V1 uses 100 for Pro Members, 50 for Credit Pack Users, and 10 for Free Users.
_Avoid_: Queue tier

**Image Task State Machine**:
The lifecycle of an image task from queued work to usable output, failure, or refund. V1 uses queued, running, storing, reviewing, succeeded, failed, and refunded.
_Avoid_: Task status list

**Provider Submission**:
The outbound request from FluxArt to an image generation provider for a specific image task.
_Avoid_: Model request

**Provider Result**:
The provider response or callback data that FluxArt normalizes into task status, stored assets, and user-visible output.
_Avoid_: Model response

**Provider Mode**:
Whether an image generation provider returns usable output synchronously or through an asynchronous external task. V1 supports sync and async modes behind the same Provider Submission and Provider Result language.
_Avoid_: API type

**Asset Object Key**:
The MinIO object key for a stored source image, mask, or generated asset. Public bucket keys must include non-guessable ids and should not rely on sequential database ids for secrecy.
_Avoid_: File path

**Public Asset URL**:
The public MinIO URL stored for an asset. In V1, the URL is convenient for delivery but the application database remains the source of truth for ownership, history visibility, and download rights.
_Avoid_: Permission url

**Payment Provider Adapter**:
The server-side integration layer that creates payment requests and verifies payment notifications from Epay or another payment provider.
_Avoid_: Payment config

**Payment Notification**:
The provider callback that confirms whether an order has been paid. In V1, the notification is the source of truth for granting credits or membership benefits; return page redirects only update UI state.
_Avoid_: Payment success page

**Provider Trade Number**:
The payment provider's transaction identifier stored for reconciliation after a local order is paid.
_Avoid_: Payment id

**Order Fulfillment**:
The transactional process that grants Purchased Credits, membership cycles, monthly Promotional Credits, or other entitlements after a paid order notification is verified.
_Avoid_: Payment side effect

**Entitlement Snapshot**:
A stored copy of the user's relevant paid rights at the moment an order, asset, or download right is created. It helps future billing support, asset authorization, and audit work.
_Avoid_: Current plan cache

**Commercial Authorization Statement**:
A product-visible statement for Pro-generated assets that records the platform-side commercial usage benefit available at generation time. It is not shown on User Uploaded Assets and does not cover third-party rights in user uploads, trademarks, likeness, or external source material.
_Avoid_: Full legal license

**Asset Retention Policy**:
The rule that decides how long generated and user uploaded assets stay visible in user history and when stored files can be physically cleaned up. V1 limits Free User visible history but keeps paid-user generated assets long-lived.
_Avoid_: Storage cleanup

**Soft Deleted Asset**:
A user-deleted asset hidden from normal asset center browsing by a deletedAt timestamp while database audit records, source relationships, and optional MinIO cleanup remain separate. Deleting a source asset does not delete assets that were generated from it.
_Avoid_: Deleted file

**User Uploaded Asset**:
An image supplied by the user that is saved into the asset center as a first-class asset without being produced by an image task. In V1 it can be used as Image-to-Image source material only, and it does not receive platform-side commercial authorization for generated assets.
_Avoid_: Generated result, temporary upload, Pro generated asset

**Asset Display Title**:
A user-facing name for an asset in the asset center. User Uploaded Assets default their display title from the original file name so they remain recognizable without a prompt.
_Avoid_: Prompt, object key, asset id

**Asset Origin**:
The product source of an asset, such as generated or uploaded. Asset Origin is used to explain lifecycle and rights boundaries, but it is not a substitute for ownership or download authorization.
_Avoid_: Task type, permission flag

**Asset Upload Entry Point**:
The user-facing place where a User Uploaded Asset is created. V1 treats the asset center upload button as the primary single-image entry point and the workspace reference-image area as a shortcut to the same capability.
_Avoid_: Batch uploader, separate uploader, workspace-only upload

**Upload Constraint**:
The server-side file validation rules for User Uploaded Assets, source images, and masks before they become usable in the product. V1 accepts JPEG, PNG, and WebP images up to 10MB and 4096px maximum edge, with server-side MIME, extension, and file signature checks.
_Avoid_: Frontend upload hint

**Credit Spend Priority**:
The order in which Credit Buckets are consumed: expiring Promotional Credits first, then monthly membership grants, then Purchased Credits.
_Avoid_: Deduction strategy

**Base Credit Cost**:
The standard credit cost for one unit of a billable capability before membership discounts or promotions.
_Avoid_: Unit price, base price

**Billable Capability**:
A product action that can consume credits, such as Text-to-Image, Image-to-Image, or HD Download.
_Avoid_: Paid feature

**Free User**:
A user who has not purchased credits or an active membership. Free Users can experience limited generation quality and workflow value, but are not promised heavy usage.
_Avoid_: Guest, trial user

**Self-Declared Account**:
An account created from user-provided credentials without requiring phone or email ownership verification in V1.
_Avoid_: Anonymous account, verified account

**User Session**:
A server-side login session represented to the browser by an httpOnly cookie. V1 sessions last 30 days with sliding renewal and a 90-day absolute maximum lifetime.
_Avoid_: Login state, client session

**Active Session Limit**:
The maximum number of non-revoked User Sessions a single account can keep at the same time. V1 allows up to five active sessions per user and removes the oldest active session when the limit is exceeded.
_Avoid_: Device limit

**Username Credential**:
A user-chosen unique login identifier. V1 uses Username Credentials instead of requiring phone or email ownership verification.
_Avoid_: Account name, login name

**Display Name**:
A user-facing profile label that does not need to be unique and is not used for authentication.
_Avoid_: Nickname when discussing authentication

**Credit Pack User**:
A user who has purchased a fixed credit package. Credit Pack Users pay by consumption and are a fit for occasional projects or temporary campaign work.
_Avoid_: Pay-as-you-go user, paid user

**Credit Pack**:
A paid package that grants a fixed amount of Purchased Credits. V1 offers 500, 1500, and 5000 credit packs.
_Avoid_: Recharge package, top-up plan

**Pro Member**:
A user with an active recurring membership. Pro Members receive membership benefits such as monthly credits, better download rights, higher concurrency, priority queueing, and commercial authorization wording.
_Avoid_: Subscriber, unlimited user

**Monthly Credit Grant**:
Credits granted as part of a Pro membership cycle. These credits are not an unlimited generation entitlement.
_Avoid_: Unlimited quota, membership balance

**Membership Cycle**:
The active billing period for a Pro Member. Monthly Credit Grants are valid only within their Membership Cycle.
_Avoid_: Subscription month

**Membership Discount**:
A reduction in Base Credit Cost granted by membership status. FluxArt V1 does not include Membership Discounts.
_Avoid_: Pro discount

**Watermarked Download**:
A standard-resolution download that includes a product watermark. This is the default download right for Free Users.
_Avoid_: Free download

**HD Download**:
A higher-quality download that may be unlocked by Pro membership or paid for with credits.
_Avoid_: Original download

**Fair-Use Cap**:
A high monthly usage cap applied to an included membership benefit to prevent abuse while staying invisible to ordinary users.
_Avoid_: Hard quota, hidden limit

**Priority Queue**:
A membership benefit that places eligible tasks ahead of lower-priority work without removing credit consumption.
_Avoid_: Fast lane, unlimited speed

**Text-to-Image**:
An image task that creates images from a text prompt without requiring a source asset.
_Avoid_: T2I when writing product copy

**Image-to-Image**:
An image task that creates a variation from an existing source asset or uploaded source image.
_Avoid_: I2I when writing product copy

**Limited Trial Capability**:
A capability available to Free Users with tighter quantity, file size, concurrency, or frequency limits than paid users.
_Avoid_: Free feature
