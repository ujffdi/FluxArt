# Use conservative V1 image upload constraints

FluxArt V1 will accept JPEG, PNG, and WebP images up to 10MB with a maximum edge of 4096px for User Uploaded Assets and source images. Masks can accept PNG or WebP and should be normalized to alpha-capable PNG before provider submission when needed. The server must validate MIME type, extension, and file signature. Files that fail validation should not create image tasks, visible user assets, or credit holds.
