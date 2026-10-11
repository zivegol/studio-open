ALTER TABLE `clienti` ADD COLUMN `studioClientId` varchar(36) NULL;
UPDATE `clienti` SET `studioClientId` = UUID() WHERE `studioClientId` IS NULL;
ALTER TABLE `clienti` MODIFY COLUMN `studioClientId` varchar(36) NOT NULL;
CREATE UNIQUE INDEX `clienti_studioClientId_unique` ON `clienti` (`studioClientId`);

ALTER TABLE `incarichi` ADD COLUMN `studioDossierId` varchar(36) NULL;
UPDATE `incarichi` SET `studioDossierId` = UUID() WHERE `studioDossierId` IS NULL;
ALTER TABLE `incarichi` MODIFY COLUMN `studioDossierId` varchar(36) NOT NULL;
CREATE UNIQUE INDEX `incarichi_studioDossierId_unique` ON `incarichi` (`studioDossierId`);

ALTER TABLE `documenti` ADD COLUMN `studioSourceId` varchar(36) NULL;
ALTER TABLE `documenti` ADD COLUMN `contentHash` varchar(71) NULL;
ALTER TABLE `documenti` ADD COLUMN `sourceEtag` varchar(255) NULL;
ALTER TABLE `documenti` ADD COLUMN `classification` enum('internal','confidential','restricted') DEFAULT 'restricted';
UPDATE `documenti` SET `studioSourceId` = UUID() WHERE `studioSourceId` IS NULL;
UPDATE `documenti` SET `classification` = 'restricted' WHERE `classification` IS NULL;
ALTER TABLE `documenti` MODIFY COLUMN `studioSourceId` varchar(36) NOT NULL;
ALTER TABLE `documenti` MODIFY COLUMN `classification` enum('internal','confidential','restricted') NOT NULL DEFAULT 'restricted';
CREATE UNIQUE INDEX `documenti_studioSourceId_unique` ON `documenti` (`studioSourceId`);

CREATE TABLE `studio_jobs` (
  `jobId` varchar(36) NOT NULL,
  `correlationId` varchar(36) NOT NULL,
  `incaricoId` int NOT NULL,
  `appId` varchar(64) NOT NULL,
  `jobType` varchar(80) NOT NULL,
  `state` enum('queued','processing','ready','partial','failed','stale') NOT NULL DEFAULT 'queued',
  `parameters` json NULL,
  `metrics` json NULL,
  `errorCode` varchar(100) NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`jobId`),
  KEY `studio_jobs_incarico_state_idx` (`incaricoId`, `state`)
);

CREATE TABLE `studio_evidence` (
  `evidenceId` varchar(36) NOT NULL,
  `jobId` varchar(36) NULL,
  `incaricoId` int NOT NULL,
  `documentoId` int NULL,
  `kind` varchar(80) NOT NULL,
  `statement` text NOT NULL,
  `sourceReference` json NOT NULL,
  `confidence` decimal(5,4) NULL,
  `status` enum('extracted','verified','rejected') NOT NULL DEFAULT 'extracted',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`evidenceId`),
  KEY `studio_evidence_incarico_idx` (`incaricoId`),
  KEY `studio_evidence_job_idx` (`jobId`)
);

CREATE TABLE `studio_results` (
  `resultId` varchar(36) NOT NULL,
  `jobId` varchar(36) NULL,
  `incaricoId` int NOT NULL,
  `resultType` varchar(80) NOT NULL,
  `status` enum('draft','completed','approved','rejected') NOT NULL DEFAULT 'draft',
  `payload` json NULL,
  `provenance` json NOT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`resultId`),
  KEY `studio_results_incarico_idx` (`incaricoId`),
  KEY `studio_results_job_idx` (`jobId`)
);

CREATE TABLE `studio_audit_events` (
  `eventId` varchar(36) NOT NULL,
  `correlationId` varchar(36) NOT NULL,
  `actorUserId` int NOT NULL,
  `appId` varchar(64) NOT NULL,
  `eventType` varchar(100) NOT NULL,
  `outcome` enum('started','success','failure','denied') NOT NULL,
  `targetType` varchar(80) NOT NULL,
  `targetId` varchar(100) NOT NULL,
  `metrics` json NULL,
  `reasonCode` varchar(100) NULL,
  `privacyClass` enum('internal','confidential','restricted') NOT NULL DEFAULT 'restricted',
  `occurredAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`eventId`),
  KEY `studio_audit_correlation_idx` (`correlationId`),
  KEY `studio_audit_target_idx` (`targetType`, `targetId`)
);
