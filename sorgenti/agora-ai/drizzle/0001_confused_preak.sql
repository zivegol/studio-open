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
	`status` enum('queued','running','completed','failed','skipped') NOT NULL DEFAULT 'queued',
	`response` text,
	`error` text,
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
	`status` enum('draft','running','completed','failed') NOT NULL DEFAULT 'draft',
	`final_synthesis` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deliberation_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `deliberation_sessions_user_id_unique` UNIQUE(`user_id`,`id`)
);
