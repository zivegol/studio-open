CREATE TABLE `roadmap_step_note` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`stepId` varchar(64) NOT NULL,
	`nota` text NOT NULL,
	`autore` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roadmap_step_note_id` PRIMARY KEY(`id`)
);
