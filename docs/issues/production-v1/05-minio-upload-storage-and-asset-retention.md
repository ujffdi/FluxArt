# Add MinIO upload, storage, and asset retention

## What to build

Store source images, masks, and generated assets in a public MinIO bucket with non-guessable object keys and application-owned asset records.

## Acceptance criteria

- [ ] Server-side upload validation accepts JPEG, PNG, and WebP source images up to 10MB and 4096px maximum edge.
- [ ] Mask upload accepts PNG and WebP and normalizes to provider-compatible alpha-capable data when needed.
- [ ] MinIO object keys include UUID or ULID identifiers and do not rely on sequential ids for secrecy.
- [ ] Asset records store object key, public URL, MIME type, size, width, and height.
- [ ] User-visible history enforces Free User retention of 7 days or 20 visible assets, whichever is stricter.
- [ ] User deletion soft-deletes assets with `deletedAt`; physical MinIO cleanup can run later.
- [ ] Billing, ledger, order, and task records remain available for audit after asset deletion.

## Blocked by

- `01-prisma-mysql-production-persistence.md`
- `02-self-declared-auth-and-sessions.md`
