# Use simple V1 task concurrency and priority limits

FluxArt V1 will use explicit task concurrency and priority rules by user tier. Free Users can run 1 task at a time, Credit Pack Users can run 2, and Pro Members can run 4. Queue priority is stored as 10 for Free Users, 50 for Credit Pack Users, and 100 for Pro Members. Requests over the running task limit should not hold credits or create image tasks.
