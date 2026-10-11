CREATE TABLE `aree_controllo` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`area` enum('crediti_clienti','debiti_fornitori','rimanenze','immobilizzazioni_mat','immobilizzazioni_immat','disponibilita_liquide','patrimonio_netto','ricavi_costi','debiti_tributari','fondi_rischi','parti_correlate','continuita_aziendale') NOT NULL,
	`valoreBilancio` decimal(15,2),
	`valoreStorico` decimal(15,2),
	`deltaPercentuale` decimal(7,2),
	`livelloRischio` enum('basso','medio','alto','critico') DEFAULT 'medio',
	`motivazioneRischio` text,
	`procedureSuggerite` json,
	`stato` enum('da_iniziare','in_corso','completata','non_applicabile') DEFAULT 'da_iniziare',
	`noteRevisore` text,
	`evidenze` json,
	`sessioneCircolarizzazioneId` int,
	`sessioneVerificaIncassiId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aree_controllo_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategia_revisione` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`fase` enum('accettazione','revisione') NOT NULL,
	`analisiTrendStorici` text,
	`indicatoriRischio` json,
	`areeRischioIdentificate` json,
	`pianoStrategico` text,
	`prioritaControlli` json,
	`variazioniSignificative` json,
	`noteRevisore` text,
	`generataConAi` boolean DEFAULT false,
	`completata` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategia_revisione_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `incarichi` ADD `faseCorrente` enum('accettazione','revisione') DEFAULT 'accettazione';