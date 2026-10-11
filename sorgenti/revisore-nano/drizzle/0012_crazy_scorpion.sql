CREATE TABLE `wizard_sessioni` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`stepCorrente` int NOT NULL DEFAULT 1,
	`stato_wizard` enum('in_corso','completato','annullato') NOT NULL DEFAULT 'in_corso',
	`risultatiBilancio` json,
	`risultatiEstrattoConto` json,
	`risultatiPartitario` json,
	`risultatiDocumentiSocietari` json,
	`riepilogoFinale` json,
	`azioniEseguite` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wizard_sessioni_id` PRIMARY KEY(`id`)
);
