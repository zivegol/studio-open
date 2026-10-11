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
	`include_in_context` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `session_attachments_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_attachments_user_session_id_unique` UNIQUE(`user_id`,`session_id`,`id`)
);
