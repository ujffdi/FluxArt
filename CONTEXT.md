# FluxArt Product Context

FluxArt is an online AI image generation product. This context defines the product language for accounts, credits, image generation, downloads, and billing.

## Language

**Credit**:
A prepaid unit of consumption used to pay for image generation, image editing, outpainting, and some downloads.
_Avoid_: Token, coin, point

**Purchased Credit**:
Credit obtained through a paid credit package. New Purchased Credits are valid for one month after purchase in the current product model.
_Avoid_: Paid point, cash credit

**Credit Validity Window**:
The time period during which a Credit Bucket can be spent. New Credit Buckets are valid for one month after they are granted or purchased; existing buckets keep their previously assigned validity windows unless a migration explicitly changes them.
_Avoid_: Expiry rule

**Promotional Credit**:
Credit granted by registration, daily refresh, or campaign. Promotional Credits may have stricter validity, accumulation, and usage rules than Purchased Credits.
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
The maximum number of image tasks a user can have running at the same time. V1 allows 1 for Free Users and 4 for Credit Pack Users.
_Avoid_: Rate limit

**Task Priority**:
The numeric priority stored on an image task for queue ordering. V1 uses 50 for Credit Pack Users and 10 for Free Users.
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

**Active Image Model Configuration**:
The legacy single-model configuration concept that preceded Selectable Image Models. New model-selection work should use Selectable Image Models and Default Image Model language instead.
_Avoid_: User model selection, model catalog

**Image Model Snapshot**:
The provider and model name recorded on an image task at creation time. It preserves which model the task used even if the platform default or selectable model list changes later.
_Avoid_: Current model, display model

**Model Administration**:
The restricted operational capability to inspect and change Selectable Image Models and the Default Image Model. V1 grants it to usernames in the admin allowlist, defaulting to `tongsr`, with `FLUXART_ADMIN_SECRET` kept as a backup access path for other authenticated operators.
_Avoid_: User settings, model preference

**Model Configuration Test**:
An optional operational check that verifies an image model configuration can reach the provider and receive a valid response. It does not create user assets, consume user credits, or prove final output quality.
_Avoid_: Test generation, free task

**Model Configuration Change**:
An audit record of a saved change to Selectable Image Models or the Default Image Model. It records who changed model administration state, when it changed, and non-secret before-and-after configuration summaries.
_Avoid_: Settings save log, admin activity blob

**Selectable Image Model**:
An admin-configured image model that eligible users may choose when creating new image tasks. Each Selectable Image Model has a display name, provider, model name, base URL, secret reference, execution mode, timeout, enabled state, and default marker.
_Avoid_: User model config, custom model

**Default Image Model**:
The single enabled Selectable Image Model FluxArt uses when a user is not eligible for model selection or has not chosen a model. Model Administration must keep exactly one Default Image Model and at least one enabled Selectable Image Model.
_Avoid_: Fallback model, free model

**Model Selection Eligibility**:
The product right to choose among Selectable Image Models. V1 grants this right after a user has successfully purchased any Credit Pack, but task creation still requires enough unexpired credits and the selected model does not change the Base Credit Cost.
_Avoid_: Model unlock, paid model access

**Model Selection Prompt**:
The user-facing purchase guidance shown when a Free User encounters model selection. It explains that purchasing credits enables model choice while the Default Image Model remains available for free trial usage.
_Avoid_: Mode upsell, locked dropdown copy

**Preferred Image Model**:
The Selectable Image Model a model-eligible user last chose for new image tasks. It is a user preference, while Image Model Snapshot records what an individual task actually used.
_Avoid_: Current model, saved task model

**Unavailable Preferred Image Model**:
A Preferred Image Model that is no longer enabled for new image tasks. FluxArt falls back to the Default Image Model for new tasks while historical Image Model Snapshots remain unchanged.
_Avoid_: Deleted model, broken preference

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
The provider callback that confirms whether an order has been paid. In V1, the notification is the source of truth for granting credits; return page redirects only update UI state.
_Avoid_: Payment success page

**Provider Trade Number**:
The payment provider's transaction identifier stored for reconciliation after a local order is paid.
_Avoid_: Payment id

**Order Fulfillment**:
The transactional process that grants Purchased Credits after a paid order notification is verified.
_Avoid_: Payment side effect

**Entitlement Snapshot**:
A stored copy of the user's relevant paid rights at the moment an order, asset, or download right is created. It helps future billing support, asset authorization, and audit work.
_Avoid_: Current plan cache

**Asset Retention Policy**:
The rule that decides how long generated and user uploaded assets stay visible in user history and when stored files can be physically cleaned up. V1 limits Free User visible history but keeps paid-user generated assets long-lived.
_Avoid_: Storage cleanup

**Soft Deleted Asset**:
A user-deleted asset hidden from normal asset center browsing by a deletedAt timestamp while database audit records, source relationships, and optional MinIO cleanup remain separate. Deleting a source asset does not delete assets that were generated from it.
_Avoid_: Deleted file

**User Uploaded Asset**:
An image supplied by the user that is saved into the asset center as a first-class asset without being produced by an image task. In V1 it can be used as Image-to-Image source material only.
_Avoid_: Generated result, temporary upload

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
The order in which Credit Buckets are consumed: expiring Promotional Credits first, then Purchased Credits.
_Avoid_: Deduction strategy

**Base Credit Cost**:
The standard credit cost for one unit of a billable capability before promotions.
_Avoid_: Unit price, base price

**Billable Capability**:
A product action that can consume credits, such as Text-to-Image, Image-to-Image, or HD Download.
_Avoid_: Paid feature

**Free User**:
A user who has not purchased credits. Free Users can experience limited generation quality and workflow value, but are not promised heavy usage.
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
A paid package that grants a fixed amount of one-month Purchased Credits. V1 offers 500, 1500, and 5000 credit packs.
_Avoid_: Recharge package, top-up plan

**Account and Credits Surface**:
The product area where a user checks account state, current credit balance, Credit Pack purchase options, and recent order status.
_Avoid_: User system, recharge center, separate billing page

**Watermarked Download**:
A standard-resolution download that includes a product watermark. This is the default download right for Free Users.
_Avoid_: Free download

**HD Download**:
A higher-quality download unlocked with credits.
_Avoid_: Original download

**Priority Queue**:
A paid-account behavior that places eligible Credit Pack User tasks ahead of lower-priority Free User work without removing credit consumption.
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
