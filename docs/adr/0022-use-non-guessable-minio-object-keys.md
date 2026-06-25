# Use non-guessable MinIO object keys

FluxArt V1 will use a public MinIO bucket, but stored object keys must include UUID or ULID identifiers rather than only sequential ids. Source uploads, masks, and generated assets should be stored under user and task scoped prefixes, while the database stores objectKey, publicUrl, mimeType, size, width, and height. Public URLs support simple delivery; application records still control ownership, history visibility, and download rights.
