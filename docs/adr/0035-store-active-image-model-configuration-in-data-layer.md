# Store active image model configuration in the data layer

FluxArt will store the Active Image Model Configuration in the repository data layer, using Prisma/MySQL in production and an in-memory default in mock mode, instead of writing environment files from the admin UI. This keeps runtime model switching durable and immediate for new image tasks while keeping secret values outside the database by storing only a secret reference such as `FLUXART_IMAGE_API_KEY`.
