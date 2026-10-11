ALTER TABLE `agent_runs` ADD `tier` enum('junior','senior') DEFAULT 'senior' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `resolved_model` varchar(128);--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `mode` enum('economic','deep') DEFAULT 'deep' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `parent_session_id` varchar(21);--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `junior_dossier` text;