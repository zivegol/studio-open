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
