CREATE TABLE `external_identities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `issuer` varchar(512) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `email_at_login` varchar(320),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `last_seen_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `external_identities_id` PRIMARY KEY(`id`),
  CONSTRAINT `external_identities_issuer_subject_unique` UNIQUE(`issuer`,`subject`)
);

CREATE TABLE `session_shares` (
  `id` int AUTO_INCREMENT NOT NULL,
  `session_id` varchar(21) NOT NULL,
  `grantee_user_id` int NOT NULL,
  `permission` enum('view','comment') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `revoked_at` timestamp NULL,
  CONSTRAINT `session_shares_id` PRIMARY KEY(`id`),
  CONSTRAINT `session_shares_session_grantee_unique` UNIQUE(`session_id`,`grantee_user_id`)
);

ALTER TABLE `session_attachments`
  ADD `source` enum('external','nextcloud') NOT NULL DEFAULT 'external',
  ADD `anonymization_status` enum('anonymized','not_anonymized') NOT NULL DEFAULT 'not_anonymized',
  ADD `ai_disclosure_confirmed_at` timestamp NULL,
  ADD `source_reference` varchar(640) NULL;
