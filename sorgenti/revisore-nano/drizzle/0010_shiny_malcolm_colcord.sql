CREATE TABLE `roadmap_step_completati` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`stepId` varchar(64) NOT NULL,
	`completato` boolean NOT NULL DEFAULT true,
	`noteRevisore` text,
	`dataCompletamento` timestamp DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `roadmap_step_completati_id` PRIMARY KEY(`id`)
);
