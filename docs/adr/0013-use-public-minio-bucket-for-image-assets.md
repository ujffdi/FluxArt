# Use a public MinIO bucket for image assets

FluxArt will store image assets in MinIO and use a public bucket for V1. This keeps delivery simple and avoids signed URL complexity at launch, while server-side records still own asset visibility, download rights, and future migration to private buckets or signed URLs.
