# Add workspace model dropdown and purchase prompt

Status: ready-for-agent

## Parent

[PRD: Model selection and one-month credit validity](../PRD.md)

## What to build

Add the user-facing workspace model-selection experience. Free Users should see a disabled model dropdown showing the Default Image Model plus a Model Selection Prompt with a purchase entry point. Credit Pack Users should see enabled Selectable Image Models in the model dropdown. Insufficient credits should block generation through the existing balance path while preserving model selection and guiding the user to buy credits.

This slice should be demoable in the browser for both Free User and Credit Pack User states.

## Acceptance criteria

- [ ] Free Users see a disabled control labeled as model selection, not mode selection.
- [ ] Free Users see the Default Image Model in that disabled control.
- [ ] Free Users see a Model Selection Prompt explaining that purchasing credits unlocks model choice.
- [ ] The Model Selection Prompt provides a direct route to the credit purchase flow.
- [ ] Credit Pack Users see enabled Selectable Image Models in the workspace model dropdown.
- [ ] Disabled Selectable Image Models do not appear as options for new work.
- [ ] Credit Pack Users with insufficient credits can still view/select models, but generation is blocked with purchase guidance.
- [ ] If a previously selected model becomes unavailable, the workspace falls back to the Default Image Model and explains the change once.
- [ ] Browser verification covers Free User, Credit Pack User, insufficient-credit, and disabled-selected-model states.

## Blocked by

- [02-selectable-image-model-admin.md](./02-selectable-image-model-admin.md)
- [03-server-side-model-selection.md](./03-server-side-model-selection.md)
