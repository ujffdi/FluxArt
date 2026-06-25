# Add self-declared auth and server sessions

## What to build

Allow users to register and log in with a username and password, backed by server-side sessions and durable account records.

## Acceptance criteria

- [ ] Registration accepts username, password, and optional display name without phone or email.
- [ ] Username validation enforces uniqueness and the V1 character rules.
- [ ] Passwords are stored only as secure server-side hashes.
- [ ] Login creates an httpOnly cookie session with sliding expiry and absolute expiry.
- [ ] A user can keep up to five active sessions; the sixth login revokes the oldest active session.
- [ ] Password change revokes existing sessions.
- [ ] Account and workspace APIs resolve the authenticated user from the server session instead of a front-end simulation.

## Blocked by

- `01-prisma-mysql-production-persistence.md`
