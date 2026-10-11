CREATE TABLE `verifica_incassi_partite` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessioneId` int NOT NULL,
	`tipo` enum('cliente','fornitore') NOT NULL,
	`codice` varchar(30),
	`ragioneSociale` varchar(255) NOT NULL,
	`numeroFattura` varchar(50),
	`dataFattura` varchar(20),
	`saldoPartita` decimal(15,2) NOT NULL,
	`statoMatching` enum('non_verificata','incassata_pagata','parzialmente_coperta','non_trovata') DEFAULT 'non_verificata',
	`importoCoperto` decimal(15,2),
	`residuo` decimal(15,2),
	`dataMovimentoBancario` varchar(20),
	`descrizioneMovimento` text,
	`confidenzaMatching` decimal(4,3),
	`noteRevisore` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verifica_incassi_partite_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verifica_incassi_sessioni` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`annoEsercizio` int NOT NULL,
	`trimestreVerifica` int DEFAULT 1,
	`totalePartiteClienti` int DEFAULT 0,
	`totalePartiteFornitori` int DEFAULT 0,
	`partiteClienteIncassate` int DEFAULT 0,
	`partiteFornitoriPagate` int DEFAULT 0,
	`importoClienteIncassato` decimal(15,2),
	`importoFornitorePagato` decimal(15,2),
	`percCoperturaCl` decimal(5,2),
	`percCoperturaFo` decimal(5,2),
	`stato` enum('in_elaborazione','completata','errore') DEFAULT 'in_elaborazione',
	`noteRevisore` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `verifica_incassi_sessioni_id` PRIMARY KEY(`id`)
);
