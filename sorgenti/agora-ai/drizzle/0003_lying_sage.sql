ALTER TABLE `deliberation_sessions` ADD `synthesis_input_tokens` int;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `synthesis_output_tokens` int;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `synthesis_cost_usd` double;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `synthesis_usage_source` varchar(16);