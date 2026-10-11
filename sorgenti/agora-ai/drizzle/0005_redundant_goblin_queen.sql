ALTER TABLE `agent_runs` ADD `initial_provider_charge` double;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `initial_provider_charge_unit` varchar(32);--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_provider_charge` double;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_provider_charge_unit` varchar(32);--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `openrouter_credits` double;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `manus_credits` double;