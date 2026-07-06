# Resolve model selection server-side during task creation

Status: ready-for-agent

## Parent

[PRD: Model selection and one-month credit validity](../PRD.md)

## What to build

Resolve the image model for each new task on the server from account eligibility and the enabled Selectable Image Model list. Free Users must always use the Default Image Model. Credit Pack Users may use an enabled selected model or Preferred Image Model. Disabled or missing selections fall back to the Default Image Model.

Task creation must continue to require enough unexpired credits and must keep using the fixed Base Credit Cost table. Browser-submitted provider, base URL, and secret reference values must not be trusted for task creation. Each task should keep an Image Model Snapshot of the provider and model actually used.

## Acceptance criteria

- [ ] Free User task creation uses the Default Image Model even if the request submits another model identifier.
- [ ] Credit Pack User task creation can use an enabled selected Selectable Image Model.
- [ ] Credit Pack User task creation falls back to the Default Image Model when the selected or preferred model is disabled or missing.
- [ ] Task creation still requires enough unexpired credits before a task is created.
- [ ] Model choice does not change Base Credit Cost or credit hold/refund behavior.
- [ ] Browser-submitted provider, base URL, and secret reference fields are ignored or rejected for task model resolution.
- [ ] Each created task records an Image Model Snapshot for the actual provider and model used.
- [ ] Historical tasks and assets remain displayable even if the model is later disabled.
- [ ] API validation covers Free User coercion, Credit Pack User selection, disabled-model fallback, and snapshot recording.

## Blocked by

- [02-selectable-image-model-admin.md](./02-selectable-image-model-admin.md)
