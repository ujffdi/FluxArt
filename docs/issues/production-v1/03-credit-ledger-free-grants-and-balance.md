# Add credit ledger, free grants, and balance accounting

## What to build

Make credits durable and auditable, including registration grants, lazy daily free credits, spend priority, and balance summaries.

## Acceptance criteria

- [ ] New registrations receive a 50-credit Promotional Credit registration grant.
- [ ] Free Users receive a lazy 10-credit Daily Free Credit Grant when checking balance or starting task creation, capped at 30 daily free credits.
- [ ] Credits are stored in Credit Buckets with validity windows and spend priority.
- [ ] Credit Ledger Entries are immutable and record grants, spends, refunds, releases, and adjustments.
- [ ] Balance APIs return available credits grouped clearly enough for account and billing UI.
- [ ] Insufficient balance failures do not create tasks or holds.

## Blocked by

- `01-prisma-mysql-production-persistence.md`
- `02-self-declared-auth-and-sessions.md`
