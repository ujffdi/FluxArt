# Flux Art V1

Next.js implementation of the Open Design prototype for an online AI image generation product.

## License

This repository is public, but commercial use is not permitted. Flux Art V1 is
licensed under the PolyForm Noncommercial License 1.0.0. See
[LICENSE](./LICENSE) for the full terms.

## Commands

```bash
npm install
npm run dev -- -H 127.0.0.1 -p 3107
npm run check:env
npm run smoke:env
npm run typecheck
npm run lint
npm run build
npm run smoke:api
npm run smoke:browser
```

Preview locally at `http://127.0.0.1:3107/workspace/image`.

`npm run smoke:api` starts a temporary Next.js production server on port `3117` and verifies the core API contract. Run `npm run build` first. To reuse an already running server, pass `SMOKE_BASE_URL`, for example:

```bash
SMOKE_BASE_URL=http://127.0.0.1:3107 npm run smoke:api
```

## Runtime Defaults

- Default image provider: `openai`
- Default image model: `gpt-image-2`
- Local execution defaults to mock mode so the product runs without credentials.
- Set `IMAGE_MODEL_EXECUTION=live` and `OPENAI_API_KEY` to call the OpenAI-compatible `/images/generations` endpoint.
- Override with `IMAGE_MODEL_PROVIDER`, `OPENAI_IMAGE_MODEL`, `IMAGE_MODEL_BASE_URL`, and custom provider settings in the server adapter layer.
- Copy `.env.example` to `.env.local` for local overrides. Run `npm run check:env` before live-model testing.
- Custom providers are expected to expose an OpenAI-compatible `/images/generations` API. Set `IMAGE_MODEL_PROVIDER=custom`, `IMAGE_MODEL_NAME`, `IMAGE_MODEL_BASE_URL`, `IMAGE_MODEL_API_KEY_SECRET_REF`, and the referenced secret value.

Production launch steps, migration commands, rollback notes, and the required validation checklist are documented in [docs/launch-production-v1.md](./docs/launch-production-v1.md).

## Data Layer

The V1 runs without local database software. Server code goes through `src/server/data/repositories.ts`, which currently provides an in-memory mock repository seeded from the product demo data.

This keeps the API and business services database-ready without requiring MySQL, Postgres, Redis, or MongoDB during local preview. A future database implementation should keep the same repository interfaces and swap only `getRepositories()` to return a SQLite, Postgres, MySQL, or cloud-database adapter.

Client mutations go through `src/features/flux-art/api/image-workspace-client.ts`. UI components should call this typed client instead of hand-writing `fetch`, so response parsing, API errors, and request payload shapes stay in one place.

## API Surface

- `GET /api/image/tasks`
- `GET /api/image/tasks/:taskId`
- `POST /api/image/tasks`
- `GET /api/image/assets`
- `GET /api/image/assets/:assetId`
- `POST /api/image/assets/:assetId/download`
- `GET /api/account/credits`
- `GET /api/account/membership`
- `POST /api/billing/orders`
- `POST /api/orders/credits`
- `POST /api/orders/membership`

List endpoints accept `page`, `pageSize`, `taskType`, `status`, and `q` query parameters. Invalid pagination, task type, or status values return the same JSON error envelope as mutation endpoints.

## Known Audit Note

`npm audit --omit=dev` currently reports a moderate PostCSS advisory through the installed Next.js dependency chain. `npm audit fix --force` proposes a breaking downgrade to Next 9, so this project keeps the current Next version and should pick up the upstream fix when a compatible Next release is available.
