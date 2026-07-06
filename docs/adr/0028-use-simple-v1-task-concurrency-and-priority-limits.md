# Use simple V1 task concurrency and priority limits

FluxArt V1 will use explicit task concurrency and priority rules by user tier. Free Users can run 1 task at a time, and Credit Pack Users can run 4. Queue priority is stored as 10 for Free Users and 50 for Credit Pack Users. Requests over the running task limit should not hold credits or create image tasks.
