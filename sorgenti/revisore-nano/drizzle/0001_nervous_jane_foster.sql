CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`modulo` enum('accettazione','comprensione','rischio','materialita','piano','sistema'),
	`tipoAlert` enum('rischio_elevato','going_concern','anomalia_bilancio','variazione_anomala','checklist_incompleta','info') NOT NULL,
	`severita` enum('info','warning','critical') DEFAULT 'warning',
	`titolo` varchar(255) NOT NULL,
	`messaggio` text NOT NULL,
	`datiContesto` json,
	`letto` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clienti` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`ragioneSociale` varchar(255) NOT NULL,
	`codiceFiscale` varchar(16),
	`partitaIva` varchar(11),
	`formaGiuridica` enum('srl','srl_unipersonale','snc','sas','spa','ditta_individuale','altro') DEFAULT 'srl',
	`settore` varchar(100),
	`comune` varchar(100),
	`provincia` varchar(2),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clienti_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documenti` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`nomeFile` varchar(255) NOT NULL,
	`tipoFile` enum('pdf','xml','xbrl','xlsx','csv','altro') NOT NULL,
	`tipoDocumento` enum('bilancio','nota_integrativa','verbale_assemblea','contratto','estratto_conto','libro_mastro','altro') DEFAULT 'altro',
	`s3Key` varchar(500) NOT NULL,
	`s3Url` text NOT NULL,
	`dimensioneBytes` int,
	`statoParsing` enum('in_attesa','in_corso','completato','errore') DEFAULT 'in_attesa',
	`testoEstrattoChunks` json,
	`datiStrutturati` json,
	`erroreParser` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documenti_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incarichi` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`userId` int NOT NULL,
	`annoEsercizio` int NOT NULL,
	`tipoIncarico` enum('revisione_legale','revisione_volontaria','continuazione') DEFAULT 'revisione_legale',
	`stato` enum('bozza','in_corso','completato','archiviato') DEFAULT 'bozza',
	`statoModulo1` int DEFAULT 0,
	`statoModulo2` int DEFAULT 0,
	`statoModulo3` int DEFAULT 0,
	`statoModulo4` int DEFAULT 0,
	`statoModulo5` int DEFAULT 0,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `incarichi_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modulo_accettazione` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`indipendenzaVerificata` boolean DEFAULT false,
	`competenzaVerificata` boolean DEFAULT false,
	`integritaManagementVerificata` boolean DEFAULT false,
	`rischioIncaricoPrecedente` boolean DEFAULT false,
	`conflittiInteresseVerificati` boolean DEFAULT false,
	`onorarioDefinito` boolean DEFAULT false,
	`letteraIncaricoFirmata` boolean DEFAULT false,
	`analisiAi` text,
	`flagRischiAi` json,
	`esito` enum('accettato','rifiutato','sospeso','in_valutazione') DEFAULT 'in_valutazione',
	`motivazioneEsito` text,
	`completato` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `modulo_accettazione_id` PRIMARY KEY(`id`),
	CONSTRAINT `modulo_accettazione_incaricoId_unique` UNIQUE(`incaricoId`)
);
--> statement-breakpoint
CREATE TABLE `modulo_comprensione` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`totaleAttivo` decimal(15,2),
	`ricaviNetti` decimal(15,2),
	`patrimonioNetto` decimal(15,2),
	`utilePerditaEsercizio` decimal(15,2),
	`numeroDipendenti` int,
	`debitiTotali` decimal(15,2),
	`creditiTotali` decimal(15,2),
	`disponibilitaLiquide` decimal(15,2),
	`isNanoImpresa` boolean,
	`motivazioneNano` text,
	`indici` json,
	`sintesiAi` text,
	`settoreAttivita` varchar(100),
	`principaliRischiSettore` json,
	`altriDatiRilevanti` json,
	`completato` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `modulo_comprensione_id` PRIMARY KEY(`id`),
	CONSTRAINT `modulo_comprensione_incaricoId_unique` UNIQUE(`incaricoId`)
);
--> statement-breakpoint
CREATE TABLE `modulo_materialita` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`benchmarkTipo` enum('ricavi_netti','totale_attivo','patrimonio_netto','utile_ante_imposte','costo_venduto'),
	`benchmarkValore` decimal(15,2),
	`benchmarkPercentuale` decimal(5,2),
	`motivazioneBenchmark` text,
	`overallMateriality` decimal(15,2),
	`performanceMateriality` decimal(15,2),
	`pmFattoreRiduzione` decimal(3,2),
	`clearlyTrivialThreshold` decimal(15,2),
	`primoIncarico` boolean DEFAULT false,
	`erroriAnniPrecedenti` boolean DEFAULT false,
	`controlliDeboli` boolean DEFAULT false,
	`materialitaSpecifiche` json,
	`completato` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `modulo_materialita_id` PRIMARY KEY(`id`),
	CONSTRAINT `modulo_materialita_incaricoId_unique` UNIQUE(`incaricoId`)
);
--> statement-breakpoint
CREATE TABLE `modulo_piano` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`procedurePianificate` json,
	`areeRevisione` json,
	`sintesiPianoAi` text,
	`dataInizioRevisione` timestamp,
	`dataFineRevisione` timestamp,
	`completato` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `modulo_piano_id` PRIMARY KEY(`id`),
	CONSTRAINT `modulo_piano_incaricoId_unique` UNIQUE(`incaricoId`)
);
--> statement-breakpoint
CREATE TABLE `modulo_rischio` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incaricoId` int NOT NULL,
	`rischioInerentePunteggio` int,
	`rischioInerenteNote` text,
	`rischioControlloPunteggio` int,
	`rischioControlloNote` text,
	`rischioIndividuazionePunteggio` int,
	`rmmPunteggio` int,
	`areeRischio` json,
	`analisiAiRischi` text,
	`flagRischiCritici` json,
	`indicatoriGoingConcern` json,
	`goingConcernRischio` boolean DEFAULT false,
	`completato` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `modulo_rischio_id` PRIMARY KEY(`id`),
	CONSTRAINT `modulo_rischio_incaricoId_unique` UNIQUE(`incaricoId`)
);
