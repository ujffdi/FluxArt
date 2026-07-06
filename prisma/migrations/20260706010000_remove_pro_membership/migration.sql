UPDATE `users`
SET `member_status` = 'credit_pack'
WHERE `member_status` IN ('pro_trial', 'pro');

UPDATE `credit_buckets`
SET
  `remaining_amount` = 0,
  `source_type` = 'adjustment',
  `valid_until` = COALESCE(LEAST(`valid_until`, CURRENT_TIMESTAMP(3)), CURRENT_TIMESTAMP(3)),
  `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `source_type` = 'membership';

ALTER TABLE `credit_buckets` DROP FOREIGN KEY `credit_buckets_membership_cycle_id_fkey`;
ALTER TABLE `membership_cycles` DROP FOREIGN KEY `membership_cycles_user_id_fkey`;
ALTER TABLE `membership_cycles` DROP FOREIGN KEY `membership_cycles_plan_id_fkey`;
ALTER TABLE `membership_cycles` DROP FOREIGN KEY `membership_cycles_order_id_fkey`;

ALTER TABLE `credit_buckets` DROP COLUMN `membership_cycle_id`;

ALTER TABLE `download_events`
  DROP COLUMN `pro_fair_use_applied`,
  DROP COLUMN `membership_cycle_id`;

ALTER TABLE `image_assets` DROP COLUMN `commercial_authorization_statement`;

DROP TABLE `membership_cycles`;
DROP TABLE `membership_plans`;

ALTER TABLE `users`
  MODIFY `member_status` ENUM('free', 'credit_pack') NOT NULL DEFAULT 'free';

ALTER TABLE `credit_buckets`
  MODIFY `source_type` ENUM('registration', 'daily_free', 'purchased', 'adjustment') NOT NULL;
