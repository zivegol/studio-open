CREATE TABLE `agent_model_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`provider` varchar(32) NOT NULL,
	`model` varchar(128) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_model_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_model_preferences_user_provider_unique` UNIQUE(`user_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `agent_peer_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` varchar(21) NOT NULL,
	`user_id` int NOT NULL,
	`evaluator_provider` varchar(32) NOT NULL,
	`evaluator_tier` enum('junior','senior','unknown') NOT NULL DEFAULT 'unknown',
	`evaluation_type` enum('peer','cross_tier','unknown') NOT NULL DEFAULT 'unknown',
	`subject_provider` varchar(32) NOT NULL,
	`reasoning_score` int NOT NULL,
	`evidence_score` int NOT NULL,
	`utility_score` int NOT NULL,
	`role_fit_score` int NOT NULL,
	`overall_score` double NOT NULL,
	`rationale` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_peer_evaluations_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_peer_evaluations_session_evaluator_subject_unique` UNIQUE(`session_id`,`evaluator_provider`,`subject_provider`),
	CONSTRAINT `agent_peer_evaluations_user_subject_session_unique` UNIQUE(`user_id`,`subject_provider`,`session_id`,`evaluator_provider`)
);
--> statement-breakpoint
CREATE TABLE `agent_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`provider` varchar(32) NOT NULL,
	`role` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_roles_user_provider_unique` UNIQUE(`user_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` varchar(21) NOT NULL,
	`user_id` int NOT NULL,
	`provider` varchar(32) NOT NULL,
	`role` text NOT NULL,
	`tier` enum('junior','senior') NOT NULL DEFAULT 'senior',
	`resolved_model` varchar(128),
	`fallback_model` varchar(128),
	`status` enum('queued','running','completed','failed','skipped') NOT NULL DEFAULT 'queued',
	`response` text,
	`error` text,
	`initial_input_tokens` int,
	`initial_output_tokens` int,
	`initial_cost_usd` double,
	`initial_provider_charge` double,
	`initial_provider_charge_unit` varchar(32),
	`initial_usage_source` varchar(16),
	`review_status` enum('queued','running','completed','partial','failed','skipped'),
	`review_response` text,
	`review_error` text,
	`review_repair_attempts` int NOT NULL DEFAULT 0,
	`review_input_tokens` int,
	`review_output_tokens` int,
	`review_cost_usd` double,
	`review_provider_charge` double,
	`review_provider_charge_unit` varchar(32),
	`review_usage_source` varchar(16),
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_runs_session_provider_unique` UNIQUE(`session_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `api_credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`provider` varchar(32) NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`model` varchar(128),
	`api_channel` varchar(32) NOT NULL DEFAULT 'direct',
	`input_cost_per_million` double,
	`output_cost_per_million` double,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_credentials_user_provider_unique` UNIQUE(`user_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `deliberation_sessions` (
	`id` varchar(21) NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`prompt` text NOT NULL,
	`mode` enum('economic','deep') NOT NULL DEFAULT 'deep',
	`parent_session_id` varchar(21),
	`junior_dossier` text,
	`status` enum('draft','running','completed','failed') NOT NULL DEFAULT 'draft',
	`final_synthesis` text,
	`estimated_tokens` int,
	`estimated_cost_usd` double,
	`actual_tokens` int,
	`actual_cost_usd` double,
	`cost_complete` int NOT NULL DEFAULT 0,
	`openrouter_credits` double,
	`manus_credits` double,
	`synthesis_input_tokens` int,
	`synthesis_output_tokens` int,
	`synthesis_cost_usd` double,
	`synthesis_provider_charge` double,
	`synthesis_provider_charge_unit` varchar(32),
	`synthesis_usage_source` varchar(16),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deliberation_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `deliberation_sessions_user_id_unique` UNIQUE(`user_id`,`id`)
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `session_attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`session_id` varchar(21),
	`file_name` varchar(180) NOT NULL,
	`mime_type` varchar(160) NOT NULL,
	`size_bytes` int NOT NULL,
	`storage_key` varchar(512) NOT NULL,
	`storage_url` varchar(640) NOT NULL,
	`text_excerpt` text NOT NULL,
	`source` enum('external','nextcloud') NOT NULL DEFAULT 'external',
	`anonymization_status` enum('anonymized','not_anonymized') NOT NULL DEFAULT 'not_anonymized',
	`ai_disclosure_confirmed_at` timestamp,
	`source_reference` varchar(640),
	`include_in_context` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `session_attachments_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_attachments_user_session_id_unique` UNIQUE(`user_id`,`session_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `session_shares` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` varchar(21) NOT NULL,
	`grantee_user_id` int NOT NULL,
	`permission` enum('view','comment') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`revoked_at` timestamp,
	CONSTRAINT `session_shares_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_shares_session_grantee_unique` UNIQUE(`session_id`,`grantee_user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`hard_budget_usd` double,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
