# Add Prisma/MySQL production persistence

## What to build

Create the durable Prisma/MySQL persistence foundation and wire it behind the existing repository boundary so the product can move from in-memory data to production records without rewriting pages.

## Acceptance criteria

- [ ] Prisma is added with a MySQL datasource and environment validation for the database URL.
- [ ] Migrations define the V1 tables named in the PRD, including users, sessions, credits, orders, payments, tasks, uploads, assets, provider records, and downloads.
- [ ] A Prisma repository adapter implements the existing account, billing, image, and asset data access needs.
- [ ] Local mock mode remains available for preview when production database configuration is absent.
- [ ] Repository-level tests or smoke checks prove the Prisma adapter can create, read, update, and list the core records.

## Blocked by

- None - can start immediately.
