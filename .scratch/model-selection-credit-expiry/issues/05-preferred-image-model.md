# Persist Preferred Image Model for Credit Pack Users

Status: ready-for-agent

## Parent

[PRD: Model selection and one-month credit validity](../PRD.md)

## What to build

Persist a Credit Pack User's Preferred Image Model and use it as the default selection for future workspace visits and task creation. Free Users do not save a Preferred Image Model. When a saved preference becomes unavailable, FluxArt should fall back to the Default Image Model and show the user a one-time explanation.

This slice should complete the end-to-end preference loop: select a model, persist it, reload the workspace, create a task with it, and recover cleanly if the model is disabled later.

## Acceptance criteria

- [ ] Credit Pack Users can save a Preferred Image Model by changing the workspace model dropdown.
- [ ] Returning Credit Pack Users see their Preferred Image Model selected when it is still enabled.
- [ ] New Credit Pack Users with no preference start from the Default Image Model.
- [ ] Free Users do not save model preferences and continue to use the Default Image Model.
- [ ] Task creation uses the Preferred Image Model when no explicit selected model is provided and the preference is enabled.
- [ ] If the Preferred Image Model is disabled, the workspace and task creation path fall back to the Default Image Model.
- [ ] The disabled-preference fallback shows a one-time explanation to the user.
- [ ] Browser or API validation covers saving, reload restoration, task creation with preference, and disabled-preference fallback.

## Blocked by

- [03-server-side-model-selection.md](./03-server-side-model-selection.md)
- [04-workspace-model-dropdown-and-purchase-prompt.md](./04-workspace-model-dropdown-and-purchase-prompt.md)
