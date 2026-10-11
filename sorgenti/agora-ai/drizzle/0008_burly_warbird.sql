CREATE TABLE `agent_peer_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` varchar(21) NOT NULL,
	`user_id` int NOT NULL,
	`evaluator_provider` varchar(32) NOT NULL,
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
