CREATE TABLE `users` (
  `id` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL,
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  `member_status` ENUM('free', 'credit_pack', 'pro_trial', 'pro') NOT NULL DEFAULT 'free',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);

CREATE TABLE `user_credentials` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `hash_version` VARCHAR(32) NOT NULL DEFAULT 'scrypt-v1',
  `password_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_credentials_user_id_key` (`user_id`),
  UNIQUE KEY `user_credentials_username_key` (`username`)
);

CREATE TABLE `user_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `token_hash` VARCHAR(128) NOT NULL,
  `sliding_expires` DATETIME(3) NOT NULL,
  `absolute_expires` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `user_agent` VARCHAR(255) NULL,
  `ip_address` VARCHAR(80) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_sessions_token_hash_key` (`token_hash`),
  KEY `user_sessions_user_active_idx` (`user_id`, `revoked_at`, `sliding_expires`)
);

CREATE TABLE `auth_rate_limit_buckets` (
  `id` VARCHAR(191) NOT NULL,
  `scope` VARCHAR(191) NOT NULL,
  `count` INT NOT NULL,
  `reset_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_rate_limit_buckets_scope_key` (`scope`)
);

CREATE TABLE `credit_pack_skus` (
  `id` VARCHAR(191) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL,
  `credit_amount` INT NOT NULL,
  `price_cents` INT NOT NULL,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `credit_pack_skus_code_key` (`code`)
);

CREATE TABLE `membership_plans` (
  `id` VARCHAR(191) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL,
  `monthly_price_cents` INT NOT NULL,
  `monthly_credit_grant` INT NOT NULL,
  `hd_fair_use_cap` INT NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `membership_plans_code_key` (`code`)
);

CREATE TABLE `orders` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `plan_id` VARCHAR(64) NOT NULL,
  `amount_cents` INT NOT NULL,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
  `provider` VARCHAR(32) NOT NULL DEFAULT 'epay',
  `out_trade_no` VARCHAR(96) NOT NULL,
  `status` ENUM('pending_payment', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending_payment',
  `fulfillment_status` ENUM('pending', 'fulfilled', 'failed', 'retryable') NOT NULL DEFAULT 'pending',
  `payment_url` VARCHAR(512) NULL,
  `paid_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `orders_out_trade_no_key` (`out_trade_no`),
  KEY `orders_user_status_idx` (`user_id`, `status`)
);

CREATE TABLE `membership_cycles` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `plan_id` VARCHAR(191) NOT NULL,
  `order_id` VARCHAR(191) NULL,
  `cycle_start` DATETIME(3) NOT NULL,
  `cycle_end` DATETIME(3) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `hd_downloads_used` INT NOT NULL DEFAULT 0,
  `hd_fair_use_cap` INT NOT NULL DEFAULT 300,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `membership_cycles_user_end_idx` (`user_id`, `cycle_end`)
);

CREATE TABLE `credit_buckets` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `source_type` ENUM('registration', 'daily_free', 'purchased', 'membership', 'adjustment') NOT NULL,
  `credit_type` ENUM('promotional', 'purchased') NOT NULL,
  `original_amount` INT NOT NULL,
  `remaining_amount` INT NOT NULL,
  `valid_from` DATETIME(3) NOT NULL,
  `valid_until` DATETIME(3) NULL,
  `priority` INT NOT NULL,
  `source_order_id` VARCHAR(191) NULL,
  `membership_cycle_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `credit_buckets_user_priority_idx` (`user_id`, `priority`, `valid_until`)
);

CREATE TABLE `credit_holds` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `amount` INT NOT NULL,
  `status` ENUM('active', 'spent', 'released', 'refunded', 'expired') NOT NULL DEFAULT 'active',
  `task_id` VARCHAR(191) NULL,
  `download_id` VARCHAR(191) NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `converted_at` DATETIME(3) NULL,
  `refunded_at` DATETIME(3) NULL,
  `released_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `credit_holds_download_id_key` (`download_id`),
  KEY `credit_holds_user_status_idx` (`user_id`, `status`, `expires_at`)
);

CREATE TABLE `credit_ledger_entries` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `bucket_id` VARCHAR(191) NULL,
  `hold_id` VARCHAR(191) NULL,
  `entry_type` ENUM('grant', 'hold', 'spend', 'refund', 'release', 'adjustment') NOT NULL,
  `amount` INT NOT NULL,
  `balance_after` INT NOT NULL,
  `source_ref_type` VARCHAR(64) NOT NULL,
  `source_ref_id` VARCHAR(191) NULL,
  `label` VARCHAR(160) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `credit_ledger_entries_user_created_idx` (`user_id`, `created_at`)
);

CREATE TABLE `image_uploads` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `kind` ENUM('source', 'mask') NOT NULL,
  `object_key` VARCHAR(255) NOT NULL,
  `public_url` VARCHAR(512) NOT NULL,
  `mime_type` VARCHAR(64) NOT NULL,
  `size_bytes` INT NOT NULL,
  `width` INT NOT NULL,
  `height` INT NOT NULL,
  `validation_status` ENUM('accepted', 'rejected') NOT NULL DEFAULT 'accepted',
  `failure_reason` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `image_uploads_object_key_key` (`object_key`)
);

CREATE TABLE `image_tasks` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `task_type` ENUM('t2i', 'i2i', 'inpaint', 'outpaint') NOT NULL,
  `prompt` TEXT NOT NULL,
  `negative_prompt` TEXT NULL,
  `request_payload_json` JSON NOT NULL,
  `provider` VARCHAR(64) NOT NULL,
  `model_name` VARCHAR(120) NOT NULL,
  `state` ENUM('queued', 'running', 'storing', 'reviewing', 'succeeded', 'failed', 'refunded') NOT NULL DEFAULT 'queued',
  `priority` INT NOT NULL,
  `cost_credits` INT NOT NULL,
  `source_asset_id` VARCHAR(191) NULL,
  `credit_hold_id` VARCHAR(191) NULL,
  `queued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `running_at` DATETIME(3) NULL,
  `storing_at` DATETIME(3) NULL,
  `reviewing_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `failed_at` DATETIME(3) NULL,
  `failure_reason` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `image_tasks_credit_hold_id_key` (`credit_hold_id`),
  KEY `image_tasks_user_state_priority_idx` (`user_id`, `state`, `priority`)
);

CREATE TABLE `provider_submissions` (
  `id` VARCHAR(191) NOT NULL,
  `task_id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(64) NOT NULL,
  `model_name` VARCHAR(120) NOT NULL,
  `provider_mode` ENUM('sync', 'async') NOT NULL,
  `request_metadata_json` JSON NOT NULL,
  `external_task_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `provider_submissions_task_idx` (`task_id`)
);

CREATE TABLE `provider_results` (
  `id` VARCHAR(191) NOT NULL,
  `submission_id` VARCHAR(191) NOT NULL,
  `status` ENUM('pending', 'succeeded', 'failed') NOT NULL,
  `raw_payload_digest` VARCHAR(128) NOT NULL,
  `output_metadata_json` JSON NULL,
  `error_metadata_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `provider_results_submission_idx` (`submission_id`)
);

CREATE TABLE `image_assets` (
  `id` VARCHAR(191) NOT NULL,
  `task_id` VARCHAR(191) NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `task_type` ENUM('t2i', 'i2i', 'inpaint', 'outpaint') NOT NULL,
  `prompt` TEXT NOT NULL,
  `object_key` VARCHAR(255) NOT NULL,
  `public_url` VARCHAR(512) NOT NULL,
  `mime_type` VARCHAR(64) NOT NULL,
  `size_bytes` INT NOT NULL,
  `width` INT NOT NULL,
  `height` INT NOT NULL,
  `review_status` ENUM('pending', 'approved', 'rejected', 'skipped') NOT NULL DEFAULT 'pending',
  `download_state` VARCHAR(32) NOT NULL DEFAULT 'not_downloaded',
  `model_provider` VARCHAR(64) NOT NULL,
  `model_name` VARCHAR(120) NOT NULL,
  `source_asset_id` VARCHAR(191) NULL,
  `watermark` BOOLEAN NOT NULL DEFAULT TRUE,
  `hd` BOOLEAN NOT NULL DEFAULT FALSE,
  `entitlement_snapshot_json` JSON NULL,
  `commercial_authorization_statement` VARCHAR(512) NULL,
  `deleted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `image_assets_object_key_key` (`object_key`),
  KEY `image_assets_user_visible_idx` (`user_id`, `deleted_at`, `created_at`)
);

CREATE TABLE `download_events` (
  `id` VARCHAR(191) NOT NULL,
  `asset_id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `download_type` ENUM('standard_watermarked', 'hd_no_watermark') NOT NULL,
  `credit_cost` INT NOT NULL,
  `pro_fair_use_applied` BOOLEAN NOT NULL DEFAULT FALSE,
  `membership_cycle_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `download_events_user_created_idx` (`user_id`, `created_at`)
);

CREATE TABLE `asset_version_nodes` (
  `id` VARCHAR(191) NOT NULL,
  `label` VARCHAR(160) NOT NULL,
  `asset_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `asset_version_nodes_asset_idx` (`asset_id`)
);

CREATE TABLE `payment_notifications` (
  `id` VARCHAR(191) NOT NULL,
  `order_id` VARCHAR(191) NOT NULL,
  `provider_trade_no` VARCHAR(128) NULL,
  `verified` BOOLEAN NOT NULL DEFAULT FALSE,
  `raw_payload_digest` VARCHAR(128) NOT NULL,
  `failure_reason` VARCHAR(255) NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processed_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `payment_notifications_order_digest_key` (`order_id`, `raw_payload_digest`)
);

CREATE TABLE `asset_cleanup_jobs` (
  `id` VARCHAR(191) NOT NULL,
  `asset_id` VARCHAR(191) NOT NULL,
  `object_key` VARCHAR(255) NOT NULL,
  `reason` VARCHAR(64) NOT NULL,
  `scheduled_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);

ALTER TABLE `user_credentials` ADD CONSTRAINT `user_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `membership_cycles` ADD CONSTRAINT `membership_cycles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `membership_cycles` ADD CONSTRAINT `membership_cycles_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `membership_plans`(`id`);
ALTER TABLE `membership_cycles` ADD CONSTRAINT `membership_cycles_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`);
ALTER TABLE `credit_buckets` ADD CONSTRAINT `credit_buckets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `credit_buckets` ADD CONSTRAINT `credit_buckets_source_order_id_fkey` FOREIGN KEY (`source_order_id`) REFERENCES `orders`(`id`);
ALTER TABLE `credit_buckets` ADD CONSTRAINT `credit_buckets_membership_cycle_id_fkey` FOREIGN KEY (`membership_cycle_id`) REFERENCES `membership_cycles`(`id`);
ALTER TABLE `credit_holds` ADD CONSTRAINT `credit_holds_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `credit_ledger_entries` ADD CONSTRAINT `credit_ledger_entries_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `credit_ledger_entries` ADD CONSTRAINT `credit_ledger_entries_bucket_id_fkey` FOREIGN KEY (`bucket_id`) REFERENCES `credit_buckets`(`id`);
ALTER TABLE `credit_ledger_entries` ADD CONSTRAINT `credit_ledger_entries_hold_id_fkey` FOREIGN KEY (`hold_id`) REFERENCES `credit_holds`(`id`);
ALTER TABLE `image_uploads` ADD CONSTRAINT `image_uploads_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `image_tasks` ADD CONSTRAINT `image_tasks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `image_tasks` ADD CONSTRAINT `image_tasks_credit_hold_id_fkey` FOREIGN KEY (`credit_hold_id`) REFERENCES `credit_holds`(`id`);
ALTER TABLE `provider_submissions` ADD CONSTRAINT `provider_submissions_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `image_tasks`(`id`);
ALTER TABLE `provider_results` ADD CONSTRAINT `provider_results_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `provider_submissions`(`id`);
ALTER TABLE `image_assets` ADD CONSTRAINT `image_assets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `image_assets` ADD CONSTRAINT `image_assets_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `image_tasks`(`id`);
ALTER TABLE `image_assets` ADD CONSTRAINT `image_assets_source_asset_id_fkey` FOREIGN KEY (`source_asset_id`) REFERENCES `image_assets`(`id`);
ALTER TABLE `download_events` ADD CONSTRAINT `download_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `download_events` ADD CONSTRAINT `download_events_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `image_assets`(`id`);
ALTER TABLE `asset_version_nodes` ADD CONSTRAINT `asset_version_nodes_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `image_assets`(`id`);
ALTER TABLE `credit_holds` ADD CONSTRAINT `credit_holds_download_id_fkey` FOREIGN KEY (`download_id`) REFERENCES `download_events`(`id`);
ALTER TABLE `payment_notifications` ADD CONSTRAINT `payment_notifications_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`);
