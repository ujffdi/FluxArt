# Repository Guidelines

## Project Structure & Module Organization
FluxArt is a Vite + React + TypeScript app. Application code lives in `src/`.
Use `src/main.tsx` for the React entry point, `src/App.tsx` for the root component, and keep global styles in `src/index.css`. Component-specific styles can stay beside their component, following the current `App.css` pattern. Static public files belong in `public/`; imported assets such as SVGs belong in `src/assets/`. Production output is generated in `dist/` and should not be edited by hand.

## Build, Test, and Development Commands
Install dependencies with:

```bash
npm install
```

Run the local dev server:

```bash
npm run dev
```

Create a production build and type-check the project:

```bash
npm run build
```

Run lint checks:

```bash
npm run lint
```

Preview the built app locally:

```bash
npm run preview
```

## Coding Style & Naming Conventions
Write TypeScript and React function components. Use `.tsx` for components and `.ts` for non-UI utilities. Prefer descriptive PascalCase component names, for example `ImageWorkspace.tsx`, and camelCase functions, variables, and hooks. Keep JSX readable with two-space indentation. Follow the ESLint rules in `eslint.config.js`, including React Hooks and React Refresh checks.

## Testing Guidelines
No test runner is configured yet. Until one is added, use `npm run build` and `npm run lint` as the minimum validation before submitting changes. If tests are introduced, place component tests near the component or under `src/__tests__/`, and use clear names such as `ImageWorkspace.test.tsx`.

## Commit & Pull Request Guidelines
This repository currently has no commit history, so there is no existing commit convention to preserve. Use concise, imperative commit messages such as `Add image workspace layout` or `Fix asset detail state`. Pull requests should include a short summary, validation steps run, linked issue or task context, and screenshots for visible UI changes.

## Security & Configuration Tips
Do not commit secrets, API keys, or local environment overrides. Keep generated folders such as `dist/` and dependency folders such as `node_modules/` out of source edits unless a task explicitly requires build artifact inspection.
