# Add image task credit holds and state machine

## What to build

Create image tasks only after permissions, concurrency, and credit holds pass, then drive tasks through the V1 state machine.

## Acceptance criteria

- [ ] Task creation enforces tier capabilities for Text-to-Image, Image-to-Image, Inpainting, and Outpainting.
- [ ] Task creation enforces running task limits: Free User 1, Credit Pack User 2, Pro Member 4.
- [ ] Task creation stores task priority: Free User 10, Credit Pack User 50, Pro Member 100.
- [ ] Credits are held before a task is created and converted to final spend only after approved Usable Output.
- [ ] System failures and output review failures release or refund the hold.
- [ ] Tasks use only the V1 states: queued, running, storing, reviewing, succeeded, failed, refunded.
- [ ] Task APIs expose enough state for the current workspace UI to remain useful.

## Blocked by

- `03-credit-ledger-free-grants-and-balance.md`
