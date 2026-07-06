ALTER TABLE `active_image_model_configurations`
  ADD COLUMN `display_name` VARCHAR(120) NOT NULL DEFAULT 'Default Image Model',
  ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false;

UPDATE `active_image_model_configurations`
SET `display_name` = 'Default Image Model',
    `enabled` = true,
    `is_default` = true
WHERE `id` = 'active';
