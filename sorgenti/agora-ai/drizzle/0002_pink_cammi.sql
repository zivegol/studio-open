ALTER TABLE `agent_runs` ADD `initial_input_tokens` int;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `initial_output_tokens` int;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `initial_cost_usd` double;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `initial_usage_source` varchar(16);--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_status` enum('queued','running','completed','failed','skipped');--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_response` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_error` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_input_tokens` int;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_output_tokens` int;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_cost_usd` double;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `review_usage_source` varchar(16);--> statement-breakpoint
ALTER TABLE `api_credentials` ADD `input_cost_per_million` double;--> statement-breakpoint
ALTER TABLE `api_credentials` ADD `output_cost_per_million` double;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `estimated_tokens` int;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `estimated_cost_usd` double;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `actual_tokens` int;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `actual_cost_usd` double;--> statement-breakpoint
ALTER TABLE `deliberation_sessions` ADD `cost_complete` int DEFAULT 0 NOT NULL;