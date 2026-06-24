# Repository Guidelines

## Project Structure & Module Organization
FluxArt is a Next.js App Router + React + TypeScript app. Application code lives in `src/`.
Use `src/app/**/page.tsx` for routes, `src/app/api/**/route.ts` for API Route Handlers, and `src/app/globals.css` for global styles. The main product shell lives in `src/features/flux-art/flux-art-shell.tsx`.

Keep feature-owned UI and client API code under `src/features/flux-art/`. Server-side business logic belongs in `src/server/`, with data access behind `src/server/data/repositories.ts`. Shared domain and API types belong in `src/types/`. Static public assets belong in `public/`. Production output is generated in `.next/` and should not be edited by hand.

## Build, Test, and Development Commands
Install dependencies with:

```bash
npm install
```

Run the local dev server:

```bash
npm run dev -- -H 127.0.0.1 -p 3107
```

Validate environment defaults:

```bash
npm run check:env
```

Run type, lint, build, and API smoke checks:

```bash
npm run typecheck
npm run lint
npm run build
npm run smoke:api
```

Preview locally at `http://127.0.0.1:3107/workspace/image`.

## Coding Style & Naming Conventions
Write TypeScript and React function components. Use `.tsx` for UI components and `.ts` for non-UI utilities. Prefer descriptive PascalCase component names and camelCase functions, variables, and hooks. Keep JSX readable with two-space indentation. Follow the ESLint rules in `eslint.config.mjs`, including Next.js and React Hooks checks.

For Next.js boundaries, keep secure operations, model calls, repository access, and secret-bearing environment variables on the server side. Keep browser-only APIs inside client components or effects.

## Data, Auth, and Runtime Defaults
V1 runs without local database software. The current data layer is an in-memory mock repository behind `src/server/data/repositories.ts`; future database work should replace that adapter instead of changing page or API contracts.

Login is currently a front-end session simulation in `src/stores/image-workspace-store.ts` and `src/features/flux-art/flux-art-shell.tsx`. Account entitlement APIs exist for credits and membership summaries, but there is no production auth provider yet.

Default image generation is mock execution with provider `openai` and model `gpt-image-2`. Live model execution must keep API keys in server environment variables only.

## Testing Guidelines
No unit test runner is configured yet. Until one is added, use `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run smoke:api` as the minimum validation before submitting changes. Browser verification should cover `/workspace/image`, `/workspace/image/edit/[assetId]`, `/workspace/image/assets`, `/workspace/account`, and `/workspace/billing` when UI behavior changes.

## Commit & Pull Request Guidelines
This repository currently has minimal commit history, so use concise, imperative commit messages such as `Migrate FluxArt to Next app` or `Add asset filtering API`. Pull requests should include a short summary, validation steps run, linked task context, and screenshots for visible UI changes.

## Security & Configuration Tips
Do not commit secrets, API keys, or local environment overrides. Keep generated folders such as `.next/`, `dist/`, and dependency folders such as `node_modules/` out of source edits unless a task explicitly requires build artifact inspection.
