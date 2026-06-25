# Use conservative V1 image upload constraints

FluxArt V1 will accept JPEG, PNG, and WebP source images up to 10MB with a maximum edge of 4096px. Masks can accept PNG or WebP and should be normalized to alpha-capable PNG before provider submission when needed. The server must validate MIME type, extension, and file signature. Files that fail validation should not create image tasks or hold credits.
