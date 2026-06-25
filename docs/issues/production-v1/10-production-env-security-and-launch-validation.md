# Add production environment, security, and launch validation

## What to build

Make the production configuration explicit, validate required infrastructure, and document the commands and checks needed before launch.

## Acceptance criteria

- [ ] Environment validation covers MySQL, MinIO, OpenAI/default provider, custom provider settings, session secrets, and Epay settings.
- [ ] Secrets are never exposed to client bundles or committed into the repo.
- [ ] API smoke checks cover auth, balance, task creation failure paths, order creation, and core asset listing.
- [ ] Browser smoke checks cover the five workspace routes named in AGENTS.md.
- [ ] Launch documentation explains local mock mode, production mode, migration commands, and rollback/retry notes.
- [ ] Required validation commands include typecheck, lint, build, environment validation, API smoke, and browser smoke.

## Blocked by

- `09-production-account-billing-and-workspace-ui.md`
