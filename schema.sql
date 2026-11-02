-- ============================================================================
-- DURVIX Estates — Complete MySQL Relational Database Schema & Seeding Script
-- Database Engine: MySQL 8.0+ / MariaDB 10.5+
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `durvix_estates` 
DEFAULT CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `durvix_estates`;

-- ----------------------------------------------------------------------------
-- Table 1: Users (Buyers, Agents, Admins)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `contact_messages`;
DROP TABLE IF EXISTS `bookings`;
DROP TABLE IF EXISTS `properties`;
DROP TABLE IF EXISTS `users`;

CREATE TABLE `users` (
  `id` VARCHAR(64) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(64) NOT NULL,
  `role` ENUM('USER', 'AGENT', 'ADMIN') NOT NULL DEFAULT 'USER',
  `isBlocked` BOOLEAN NOT NULL DEFAULT FALSE,
  `isApproved` BOOLEAN NOT NULL DEFAULT TRUE,
  `agency` VARCHAR(255) DEFAULT NULL,
  `bio` TEXT DEFAULT NULL,
  `avatar` VARCHAR(512) DEFAULT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_approval` (`isApproved`, `isBlocked`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table 2: Properties (Villas, Penthouses, Mansions)
-- ----------------------------------------------------------------------------
CREATE TABLE `properties` (
  `id` VARCHAR(64) NOT NULL,
  `agentId` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `price` BIGINT NOT NULL DEFAULT 0,
  `rentPrice` INT DEFAULT NULL,
  `type` ENUM('BUY', 'RENT') NOT NULL DEFAULT 'BUY',
  `city` VARCHAR(100) NOT NULL,
  `address` VARCHAR(255) NOT NULL,
  `area` VARCHAR(100) NOT NULL,
  `lat` DECIMAL(10,7) NOT NULL DEFAULT 24.8600000,
  `lng` DECIMAL(10,7) NOT NULL DEFAULT 67.0000000,
  `bedrooms` INT NOT NULL DEFAULT 1,
  `bathrooms` INT NOT NULL DEFAULT 1,
  `sizeSqft` INT NOT NULL DEFAULT 1000,
  `images` LONGTEXT NOT NULL, -- JSON array string of image URLs/Base64
  `featured` BOOLEAN NOT NULL DEFAULT FALSE,
  `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_properties_agent` (`agentId`),
  KEY `idx_properties_city_type` (`city`, `type`),
  KEY `idx_properties_status` (`status`),
  CONSTRAINT `fk_properties_agent` FOREIGN KEY (`agentId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table 3: Bookings (Token-Secured Viewing Requests — PKR 5,000)
-- ----------------------------------------------------------------------------
CREATE TABLE `bookings` (
  `id` VARCHAR(64) NOT NULL,
  `userId` VARCHAR(64) NOT NULL,
  `propertyId` VARCHAR(64) NOT NULL,
  `agentId` VARCHAR(64) NOT NULL,
  `status` ENUM('PENDING_TOKEN', 'CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_TOKEN',
  `tokenAmount` INT NOT NULL DEFAULT 5000,
  `tokenPaidAt` DATETIME DEFAULT NULL,
  `visitDate` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bookings_user` (`userId`),
  KEY `idx_bookings_property` (`propertyId`),
  KEY `idx_bookings_agent` (`agentId`),
  KEY `idx_bookings_status` (`status`),
  CONSTRAINT `fk_bookings_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bookings_property` FOREIGN KEY (`propertyId`) REFERENCES `properties` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bookings_agent` FOREIGN KEY (`agentId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table 4: Contact Messages (Platform Concierge)
-- ----------------------------------------------------------------------------
CREATE TABLE `contact_messages` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(64) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `resolved` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- INITIAL SEEDING DATA
-- ============================================================================

-- 1. Insert Initial Users
INSERT INTO `users` (`id`, `email`, `password`, `name`, `phone`, `role`, `isBlocked`, `isApproved`, `agency`, `bio`) VALUES
('usr_admin01', 'admin@durvix.com', '$2b$10$e74V6uYQ1Z5H9O/Z.y5O5e9pZ6J1s7H2g3F4e5D6c7B8a9', 'DURVIX Administrator', '+923001234567', 'ADMIN', FALSE, TRUE, 'DURVIX Estates HQ', 'Platform owner and oversight authority.'),
('usr_buyer01', 'user@durvix.com', '$2b$10$e74V6uYQ1Z5H9O/Z.y5O5e9pZ6J1s7H2g3F4e5D6c7B8a9', 'Ayesha Siddiqui', '+923011234567', 'USER', FALSE, TRUE, NULL, NULL),
('usr_agent01', 'hassan@durvix.com', '$2b$10$e74V6uYQ1Z5H9O/Z.y5O5e9pZ6J1s7H2g3F4e5D6c7B8a9', 'Hassan Ali Khan', '+923211234567', 'AGENT', FALSE, TRUE, 'DURVIX Karachi', 'Specialist in Clifton & DHA luxury residences with 12 years of curated listings.'),
('usr_agent02', 'bilal@durvix.com', '$2b$10$e74V6uYQ1Z5H9O/Z.y5O5e9pZ6J1s7H2g3F4e5D6c7B8a9', 'Bilal Ahmed', '+923331234567', 'AGENT', FALSE, TRUE, 'DURVIX Lahore', 'Counsel for heritage mansions and modern DHA estates across Lahore.'),
('usr_agent03', 'sana@durvix.com', '$2b$10$e74V6uYQ1Z5H9O/Z.y5O5e9pZ6J1s7H2g3F4e5D6c7B8a9', 'Sana Malik', '+923451234567', 'AGENT', FALSE, TRUE, 'DURVIX Islamabad', 'Curator of F-sector modern architecture and Bahria Heights penthouses.');

-- 2. Insert Sample Properties
INSERT INTO `properties` (`id`, `agentId`, `title`, `description`, `price`, `rentPrice`, `type`, `city`, `address`, `area`, `lat`, `lng`, `bedrooms`, `bathrooms`, `sizeSqft`, `images`, `featured`) VALUES
('prop_001', 'usr_agent01', 'Clifton Seaview Modern Villa', 'A statement of waterfront modernism on Clifton golden stretch. Floor-to-ceiling glazing frames the Arabian Sea while cantilevered terraces deliver uninterrupted sunsets.', 285000000, NULL, 'BUY', 'Karachi', 'Block 5, Clifton, Karachi', 'Clifton', 24.8137000, 67.0252000, 6, 7, 11500, '["https://sfile.chatglm.cn/images-ppt/6b257023c8a8.jpg", "https://sfile.chatglm.cn/images-ppt/578e14bea083.jpg"]', TRUE),
('prop_002', 'usr_agent01', 'DHA Phase 8 Sky Penthouse', 'A double-height penthouse crowning DHA Phase 8. Warm walnut joinery, bronze accents, and a wraparound terrace overlooking the city skyline.', 0, 850000, 'RENT', 'Karachi', 'DHA Phase 8, Karachi', 'DHA Phase 8', 24.8270000, 67.0695000, 4, 5, 6200, '["https://sfile.chatglm.cn/images-ppt/0fdca07f2fa9.jpg", "https://sfile.chatglm.cn/images-ppt/6cbada3d7706.jpg"]', TRUE),
('prop_003', 'usr_agent02', 'DHA Phase 6 Contemporary Villa', 'A clean-lined contemporary villa balancing concrete, glass, and warm timber in DHA Lahore.', 165000000, NULL, 'BUY', 'Lahore', 'DHA Phase 6, Sector C, Lahore', 'DHA Phase 6', 31.4489000, 74.4044000, 5, 6, 9800, '["https://sfile.chatglm.cn/images-ppt/578e14bea083.jpg", "https://sfile.chatglm.cn/images-ppt/b47e2a9c3874.jpg"]', TRUE),
('prop_004', 'usr_agent03', 'F-7 Modern Architectural Mansion', 'A landmark of Islamabad F-7 sector. Brutalist concrete volumes float over glass, anchored by a stone-clad core.', 310000000, NULL, 'BUY', 'Islamabad', 'Street 12, F-7/2, Islamabad', 'F-7', 33.7215000, 73.0571000, 7, 9, 16000, '["https://sfile.chatglm.cn/images-ppt/894626f10605.jpg", "https://sfile.chatglm.cn/images-ppt/61852f31aa75.jpg"]', TRUE);

-- ============================================================================
-- USEFUL MANAGEMENT QUERIES (RUN IN MYSQL BENCH / CLI)
-- ============================================================================
-- Query A: Unblock an Agent
-- UPDATE users SET isBlocked = FALSE, isApproved = TRUE WHERE id = 'usr_agent01';

-- Query B: Ban an Agent (Listings immediately hidden)
-- UPDATE users SET isBlocked = TRUE WHERE id = 'usr_agent01';

-- Query C: Get Total Token Revenue
-- SELECT SUM(tokenAmount) AS total_revenue FROM bookings WHERE status = 'CONFIRMED';
