# FluxArt Production V1 Launch Runbook

## Local Mock Mode

Use mock mode for UI and API preview without MySQL, MinIO, Epay, or live model credentials.

```bash
npm install
npm run check:env
npm run build
npm run smoke:api
npm run smoke:browser
```

Mock mode keeps `FLUXART_DATA_MODE=mock` and `IMAGE_MODEL_EXECUTION=mock`. Assets use deterministic local public URLs and payments use local mock payment URLs.

## Production Mode

Copy `.env.example` to `.env.local` or configure equivalent deployment secrets. Set:

- `FLUXART_DATA_MODE=prisma`
- `DATABASE_URL`
- `FLUXART_SESSION_SECRET`
- `MINIO_ENDPOINT`, `MINIO_PUBLIC_BASE_URL`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`
- `IMAGE_MODEL_EXECUTION=live`, `IMAGE_MODEL_PROVIDER`, `IMAGE_MODEL_NAME`, `IMAGE_MODEL_BASE_URL`, `IMAGE_MODEL_API_KEY_SECRET_REF`, and the referenced key
- `EPAY_API_URL`, `EPAY_MERCHANT_ID`, `EPAY_SIGNING_SECRET`, `EPAY_NOTIFY_URL`, `EPAY_RETURN_URL`

Run:

```bash
npm run check:env
npm run smoke:env
npx prisma migrate deploy
npm run typecheck
npm run lint
FLUXART_DATA_MODE=mock npm run build
npm run smoke:api
npm run smoke:browser
```

For a live preview target, build/deploy first, then run:

```bash
SMOKE_BASE_URL=https://your-preview.example.com npm run smoke:api
SMOKE_BASE_URL=https://your-preview.example.com npm run smoke:browser
```

## Rollback And Retry Notes

- Failed Epay notifications leave orders visible with `fulfillmentStatus=retryable`; users can start a new payment from billing.
- Credit holds are finalized only after usable output is approved. Failed generation releases or refunds holds.
- Asset deletion is soft delete first; object cleanup is recorded separately, so accidental UI deletion can be investigated from records before physical cleanup.
- Roll back application code by redeploying the previous build. Roll back database changes only with an explicit reverse migration reviewed against production data.
- If MinIO or provider calls fail, keep `FLUXART_DATA_MODE=prisma` and switch `IMAGE_MODEL_EXECUTION=mock` only for emergency degraded operation after communicating the limitation.

## Required Validation

Before launch, record successful output from:

```bash
npm run check:env
npm run smoke:env
npm run typecheck
npm run lint
npm run build
npm run smoke:api
npm run smoke:browser
```
