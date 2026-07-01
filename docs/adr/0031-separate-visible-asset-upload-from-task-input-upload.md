# Separate visible asset upload from task input upload

FluxArt V1 will create User Uploaded Assets through a dedicated asset-upload API instead of reusing the existing task-input upload API. The existing upload API remains responsible for source and mask files used by image tasks, while the new asset-upload API always creates a visible asset center record; this keeps temporary task inputs separate from first-class user assets and avoids making one endpoint mean two different lifecycle models.
