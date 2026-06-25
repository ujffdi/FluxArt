# Add provider runner, output review, and asset creation

## What to build

Run image generation through a replaceable provider seam, store successful outputs in MinIO, review them, and create user-visible assets only when output is usable.

## Acceptance criteria

- [ ] The default provider is OpenAI with model `gpt-image-2`.
- [ ] Custom OpenAI-compatible providers can be configured through server environment variables.
- [ ] Provider Submission and Provider Result records normalize synchronous and asynchronous provider behavior.
- [ ] V1 can execute from the Next.js server process while preserving a runner seam that can move to a queue or worker later.
- [ ] Provider success moves tasks through storing and reviewing before success.
- [ ] Lightweight output review checks provider success, readable stored file, expected format, expected dimensions, and absence of obvious failed placeholders.
- [ ] Rejected output does not become a visible asset and triggers hold refund or release.
- [ ] Approved output creates an ImageAsset and converts the Credit Hold into final spend.

## Blocked by

- `04-image-task-credit-holds-and-state-machine.md`
- `05-minio-upload-storage-and-asset-retention.md`
