# Replace single active model with admin-managed Selectable Image Models

Status: ready-for-agent

## Parent

[PRD: Model selection and one-month credit validity](../PRD.md)

## What to build

Replace the single Active Image Model Configuration product path with an admin-managed list of Selectable Image Models plus one Default Image Model. The admin experience should support creating, editing, enabling, disabling, testing, and saving model configurations while keeping provider secrets out of the database.

This slice should deliver a complete Model Administration path: persisted model list, validation, admin API behavior, admin UI behavior, Model Configuration Change audit records, and provider test support for an individual configuration.

## Acceptance criteria

- [ ] Admins can save a list of Selectable Image Models with display name, provider, model name, base URL, API key secret reference, execution mode, timeout, enabled state, and default marker.
- [ ] Saving rejects zero enabled models.
- [ ] Saving rejects no Default Image Model.
- [ ] Saving rejects more than one Default Image Model.
- [ ] Saving rejects a disabled Default Image Model.
- [ ] The Default Image Model is always one enabled Selectable Image Model.
- [ ] Model Administration stores only secret references, not plaintext API keys.
- [ ] Model Configuration Change audit records are created for saves/restores of model administration state.
- [ ] Admins can test an individual model configuration without creating user assets or spending user credits.
- [ ] Existing provider submission/result execution behavior remains compatible with the saved model configuration fields.
- [ ] API and admin browser/smoke validation cover valid saves and the default/enabled validation failures.

## Blocked by

None - can start immediately
