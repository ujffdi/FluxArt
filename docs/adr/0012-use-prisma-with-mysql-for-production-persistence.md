# Use Prisma with MySQL for production persistence

FluxArt will use MySQL as the production database and Prisma as the schema and repository adapter layer. The current in-memory repository remains a local mock, but production work should replace it with Prisma-backed repositories for users, sessions, credit buckets, credit ledger entries, image tasks, image assets, orders, and payment notifications.
