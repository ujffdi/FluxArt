# PRD: Model selection and one-month credit validity

Status: ready-for-agent

## Problem Statement

FluxArt currently treats image model choice as an operator-only Active Image Model Configuration. Users cannot choose among multiple image models, and Free Users receive the same model behavior as users who have purchased credits. This limits the product's ability to make model choice a clear paid benefit and makes it harder to guide Free Users toward purchasing credits.

FluxArt also currently treats Purchased Credits as long-lived. The new product direction is that newly granted and purchased Credit Buckets should be valid for one month, while existing Credit Buckets keep their current validity windows unless a separate migration explicitly changes them.

## Solution

FluxArt will introduce an admin-managed list of Selectable Image Models with exactly one enabled Default Image Model. Free Users can see that model choice exists, but they cannot choose among models; they use the Default Image Model and see a Model Selection Prompt that guides them to purchase credits. Credit Pack Users gain Model Selection Eligibility after any successful Credit Pack purchase. They may choose among enabled Selectable Image Models, save a Preferred Image Model, and continue to keep that eligibility even if their purchased credits are later spent or expire.

Task creation will continue to require enough unexpired credits. Model choice does not change the Base Credit Cost. Each task keeps an Image Model Snapshot of the provider and model actually used.

New Credit Buckets created after this feature ships, including Registration Credit Grants, Daily Free Credit Grants, and Purchased Credits from Credit Packs, will use a one-month Credit Validity Window. Existing Credit Buckets are not retroactively shortened.

## User Stories

1. As a Free User, I want to see that FluxArt supports model choice, so that I understand why purchasing credits has value.
2. As a Free User, I want the model dropdown to show the Default Image Model in a disabled state, so that I understand which model my free trial usage will use.
3. As a Free User, I want a clear Model Selection Prompt near the disabled model control, so that I know buying credits will unlock model selection.
4. As a Free User, I want a direct purchase entry point from the model selection prompt, so that I can move from interest to checkout without hunting for the billing page.
5. As a Free User, I want task creation to ignore any manually submitted model choice, so that the product cannot be bypassed from the browser console or API client.
6. As a Free User, I want generated tasks to use the Default Image Model, so that free trial behavior is consistent and predictable.
7. As a Free User, I want insufficient-credit messaging to still point me toward buying credits, so that I know why generation cannot proceed.
8. As a newly registered user, I want my registration credits to expire according to the current one-month validity rule, so that all new credit grants follow the same product expectation.
9. As an active Free User, I want daily free credits to expire according to the current one-month validity rule, so that free credit behavior is consistent with the rest of the balance model.
10. As a user who buys a Credit Pack, I want the payment success flow to grant Purchased Credits with a one-month validity window, so that I can see when my credits expire.
11. As a user who buys a Credit Pack, I want to become eligible for model selection after the order is fulfilled, so that purchasing credits immediately unlocks the paid model-choice experience.
12. As a Credit Pack User, I want to choose from enabled Selectable Image Models, so that I can pick the model that best fits my current image task.
13. As a Credit Pack User, I want my Preferred Image Model to be remembered, so that I do not need to reselect the same model every time I enter the workspace.
14. As a Credit Pack User, I want my first model selection state to start from the Default Image Model, so that I have a sensible baseline before making a choice.
15. As a Credit Pack User, I want task creation to use my selected model, so that the generated output reflects my choice.
16. As a Credit Pack User, I want each image task to keep an Image Model Snapshot, so that I can later see which model produced an asset even after admin settings change.
17. As a Credit Pack User, I want model selection to remain available after my credits are spent, so that I do not lose paid-user status merely because my balance is zero.
18. As a Credit Pack User, I want model selection to remain available after my credits expire, so that eligibility is based on purchase history rather than current balance.
19. As a Credit Pack User with insufficient credits, I want to keep choosing models but receive a purchase prompt when I generate, so that the blocker is clearly my balance rather than model access.
20. As a Credit Pack User whose Preferred Image Model was disabled by an admin, I want FluxArt to fall back to the Default Image Model, so that I can keep generating without encountering a broken model.
21. As a Credit Pack User whose Preferred Image Model was disabled, I want a one-time explanation that the model was switched to the Default Image Model, so that the change is not surprising.
22. As a returning Credit Pack User, I want disabled models to disappear from the model dropdown, so that I only choose models available for new tasks.
23. As a user viewing old tasks or assets, I want historical model names to remain visible even when the model has since been disabled, so that my asset history remains accurate.
24. As an admin, I want to create Selectable Image Models with display names, provider, model name, base URL, secret reference, execution mode, timeout, enabled state, and default marker, so that the model list can be managed without code deploys.
25. As an admin, I want exactly one Default Image Model, so that Free Users and users without a selected model always have deterministic model behavior.
26. As an admin, I want the Default Image Model to be required to be enabled, so that the system never points users at an unavailable model.
27. As an admin, I want at least one enabled Selectable Image Model to be required, so that generation cannot be accidentally disabled for every user.
28. As an admin, I want disabled Selectable Image Models to remain available for audit and historical task display, so that disabling does not erase history.
29. As an admin, I want model configuration changes to create Model Configuration Change records, so that production generation behavior can be audited.
30. As an admin, I want secret values to remain in environment variables and only secret references to be stored, so that model administration does not expose plaintext API keys.
31. As an admin, I want to test an individual model configuration without creating user assets or spending user credits, so that provider connectivity can be checked safely.
32. As an operator, I want the existing provider submission and provider result flow to continue to work after model selection, so that task execution remains compatible with sync and async providers.
33. As a billing operator, I want order fulfillment to grant one-month Purchased Credits, so that credit validity is enforced at the source of paid balance creation.
34. As a support operator, I want historical Credit Buckets to keep their current validity windows, so that existing users do not lose previously granted balance unexpectedly.
35. As a support operator, I want current and historical balances to be explainable by Credit Bucket validity, so that user balance questions can be answered from the ledger and bucket records.
36. As a product owner, I want model choice to be a Credit Pack User benefit without changing credit prices, so that the initial paid benefit stays simple and does not introduce model-specific pricing.
37. As a product owner, I want all models to use the current fixed Base Credit Cost table, so that credit holds, refunds, and balance display remain predictable.
38. As a product owner, I want the workspace purchase guidance to appear where model choice is blocked, so that the paid benefit is visible at the decision point.
39. As a developer, I want model selection enforcement on the server side, so that UI restrictions are not the only guardrail.
40. As a developer, I want existing smoke validation to cover the new billing, admin, and workspace behavior, so that future changes catch regressions at user-visible seams.

## Implementation Decisions

- Replace the product concept of a single Active Image Model Configuration with an admin-managed Selectable Image Model list and one Default Image Model.
- Keep Image Model Snapshot on image tasks. Snapshot fields record the provider and model actually used for the task at creation time.
- A Selectable Image Model includes display name, provider, model name, base URL, API key secret reference, execution mode, request timeout, enabled state, and default marker.
- Model Administration must validate the whole model list on save.
- Model Administration must reject configurations with zero enabled models.
- Model Administration must reject configurations with no Default Image Model.
- Model Administration must reject configurations with more than one Default Image Model.
- Model Administration must reject configurations where the Default Image Model is disabled.
- Model Administration must store only secret references, not plaintext provider keys.
- Model Configuration Change records should audit saves and restores of Selectable Image Models and the Default Image Model.
- Model Configuration Test should remain an operational check that does not create user assets, consume credits, or prove final output quality.
- Free Users are not Model Selection Eligible. They use the Default Image Model for every new image task.
- Credit Pack Users are Model Selection Eligible after a successful Credit Pack order fulfillment.
- First implementation should use Credit Pack User status as the source of Model Selection Eligibility.
- Model Selection Eligibility persists after credits are spent or expire.
- Task creation still requires enough unexpired credits, regardless of Model Selection Eligibility.
- Model choice does not change Base Credit Cost.
- Existing fixed credit costs remain the source of truth for Text-to-Image, Image-to-Image, Inpainting, Outpainting, and HD Download.
- Credit Pack Users may save a Preferred Image Model.
- Preferred Image Model is a user preference, not a task history field.
- New tasks use the requested model only when the user is Model Selection Eligible and the requested model is enabled.
- If a Model Selection Eligible user has no Preferred Image Model, new tasks default to the Default Image Model.
- If a Preferred Image Model becomes disabled, the workspace and task creation path fall back to the Default Image Model.
- Disabled models are hidden from the user-facing model dropdown for new work.
- Disabled models remain usable for historical display through Image Model Snapshots.
- Free User workspace UI should show a disabled model dropdown with the Default Image Model and a Model Selection Prompt.
- The Model Selection Prompt should link or navigate to the credit purchase flow.
- Credit Pack User workspace UI should show enabled Selectable Image Models in a model dropdown.
- Credit Pack User model dropdown changes should persist the Preferred Image Model.
- If a Credit Pack User has insufficient credits, model selection remains available but generation is blocked by the existing credit-balance path and purchase guidance.
- New Registration Credit Grants receive a one-month Credit Validity Window.
- New Daily Free Credit Grants receive a one-month Credit Validity Window.
- New Purchased Credits from Credit Packs receive a one-month Credit Validity Window.
- Existing Credit Buckets are not retroactively shortened.
- Billing order fulfillment remains the source of truth for granting Purchased Credits and setting Credit Pack User status.
- Admin and workspace API contracts should expose only user-safe model fields to the browser.
- Browser-submitted model identifiers must be resolved server-side against the enabled Selectable Image Model list.
- The server must not trust browser-submitted provider, base URL, or secret reference values for task creation.
- The product glossary and ADRs for this feature are already recorded in the repository and should be treated as the source vocabulary for implementation.

## Testing Decisions

- Tests should exercise external behavior at API and browser seams rather than asserting repository internals directly.
- The highest-value API seam is the combination of model administration state, account credit state, and image task creation.
- API validation should cover admin saving of valid and invalid model lists.
- API validation should cover Free User task creation always using the Default Image Model even if a model is submitted.
- API validation should cover Credit Pack User task creation using a selected enabled model.
- API validation should cover disabled Preferred Image Model fallback to the Default Image Model.
- API validation should cover only enabled models appearing in user-facing model choices.
- Billing validation should cover successful order fulfillment setting Credit Pack User status and granting one-month Purchased Credits.
- Billing validation should cover that spent or expired credits do not remove Model Selection Eligibility.
- Credit validation should cover new Registration Credit Grants and Daily Free Credit Grants using one-month validity.
- Credit validation should not require mutating or shortening existing Credit Buckets.
- Browser verification should cover the workspace as a Free User: disabled model dropdown, Default Image Model, purchase prompt, and link to purchase flow.
- Browser verification should cover the workspace as a Credit Pack User: enabled model dropdown, model selection persistence, and successful task creation with the selected model snapshot.
- Browser verification should cover insufficient credits for a Credit Pack User: model selection remains available, but generation shows purchase guidance.
- Browser verification should cover admin disabling a previously preferred model and the workspace falling back to the Default Image Model with a visible one-time explanation.
- Admin browser verification should cover creating or editing the model list and seeing validation for default/enabled constraints.
- Existing validation commands remain required before submitting changes: environment check, typecheck, lint, build, API smoke, and browser smoke when UI behavior changes.
- If no unit test runner is added, extend existing smoke scripts or add focused script-level checks at the API seams above.

## Out of Scope

- Model-specific pricing.
- Dynamic credit cost by provider, model, size, queue, style, or speed.
- A full role-based access-control system for model administration.
- Storing plaintext provider API keys in the database.
- Retroactively shortening existing Credit Buckets.
- Repricing existing Credit Packs.
- Membership subscriptions or Pro-tier behavior.
- Multi-tenant organization-level model catalogs.
- User-created custom provider credentials.
- Batch model comparison.
- Provider quality scoring or automatic model routing.
- Per-model usage analytics dashboards.
- New third-party auth providers.
- Rebuilding the whole workspace navigation or billing product outside the model-selection and purchase-guidance flow.

## Further Notes

- This PRD follows the glossary updates in `CONTEXT.md` and ADRs 0039, 0040, and 0041.
- ADR 0039 supersedes the earlier long-lived Purchased Credits decision for newly created Credit Buckets.
- ADR 0040 supersedes the single Active Image Model Configuration product concept.
- The implementation should preserve the existing server-side model execution boundary and keep secret-bearing values on the server.
- The current code already has model administration, model configuration change auditing, credit buckets, order fulfillment, and image task snapshots. The feature should deepen those seams instead of creating a parallel stack.
