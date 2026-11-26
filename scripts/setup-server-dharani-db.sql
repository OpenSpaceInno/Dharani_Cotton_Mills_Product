-- ==============================================================================
-- Production Server MySQL Setup for Database `dharani_weighbridge`
-- Run as MySQL root/admin on the production server (213.210.37.249):
--   mysql -u root -p < scripts/setup-server-dharani-db.sql
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS `dharani_weighbridge`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Grant full privileges on dharani_weighbridge to the sync/app user
GRANT ALL PRIVILEGES ON `dharani_weighbridge`.* TO 'rmc_user'@'%';
FLUSH PRIVILEGES;
