ALTER TABLE `image_assets`
  ADD COLUMN `origin` ENUM('generated', 'uploaded') NOT NULL DEFAULT 'generated' AFTER `user_id`,
  MODIFY COLUMN `task_type` ENUM('t2i', 'i2i', 'inpaint', 'outpaint') NULL;
