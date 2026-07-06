CREATE TABLE `active_image_model_configurations` (
  `id` VARCHAR(64) NOT NULL,
  `provider` VARCHAR(64) NOT NULL,
  `model_name` VARCHAR(120) NOT NULL,
  `base_url` VARCHAR(512) NOT NULL,
  `api_key_secret_ref` VARCHAR(128) NOT NULL,
  `execution_mode` VARCHAR(16) NOT NULL,
  `request_timeout_ms` INT NOT NULL,
  `last_test_status` VARCHAR(16) NOT NULL DEFAULT 'untested',
  `last_tested_at` DATETIME(3) NULL,
  `last_test_error` VARCHAR(512) NULL,
  `updated_by_user_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);

CREATE TABLE `model_configuration_changes` (
  `id` VARCHAR(191) NOT NULL,
  `active_configuration_id` VARCHAR(64) NOT NULL DEFAULT 'active',
  `changed_by_user_id` VARCHAR(191) NOT NULL,
  `change_type` VARCHAR(16) NOT NULL,
  `before_config_json` JSON NULL,
  `after_config_json` JSON NOT NULL,
  `test_status` VARCHAR(16) NOT NULL DEFAULT 'untested',
  `test_error` VARCHAR(512) NULL,
  `restored_from_change_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `model_configuration_changes_active_configuration_id_created_at_idx` (`active_configuration_id`, `created_at`),
  KEY `model_configuration_changes_created_at_idx` (`created_at`),
  CONSTRAINT `model_configuration_changes_active_configuration_id_fkey` FOREIGN KEY (`active_configuration_id`) REFERENCES `active_image_model_configurations`(`id`)
);
