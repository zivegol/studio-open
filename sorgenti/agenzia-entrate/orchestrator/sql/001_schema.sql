-- =====================================================================
-- Connettore cassetto fiscale - Studio studio-example
-- Fondamenta: registro deleghe, catalogo documenti, job, archivio,
-- audit log append-only con hash chain.
-- PostgreSQL 14+
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 0. RUOLI (principio del minimo privilegio)
--    orchestratore: crea e pianifica job, gestisce anagrafica/deleghe
--    worker:        esegue job, registra documenti scaricati
--    auditor:       sola lettura sui log
--    Le password vanno impostate fuori dallo script (vault / secrets).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_orchestratore') THEN
    CREATE ROLE app_orchestratore LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auditor') THEN
    CREATE ROLE app_auditor LOGIN;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. TIPI
-- ---------------------------------------------------------------------
CREATE TYPE tipo_delega AS ENUM (
  'cassetto_fiscale',        -- consultazione cassetto fiscale delegato
  'fatture_corrispettivi',   -- servizio Fatture e Corrispettivi
  'f24_versamenti',
  'dichiarazioni',
  'altro'
);

CREATE TYPE stato_job AS ENUM (
  'in_coda', 'in_esecuzione', 'completato', 'fallito',
  'annullato', 'bloccato_delega', 'attesa_autenticazione'
);

CREATE TYPE canale_scarico AS ENUM ('api_ufficiale', 'browser_automation', 'manuale');

-- ---------------------------------------------------------------------
-- 2. ANAGRAFICA CLIENTI
-- ---------------------------------------------------------------------
CREATE TABLE clienti (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codice_fiscale     varchar(16) NOT NULL UNIQUE,
  partita_iva        varchar(11),
  denominazione      text NOT NULL,
  incarico_attivo    boolean NOT NULL DEFAULT true,
  incarico_cessato_il date,                       -- avvia il calcolo della retention
  note_gdpr          text,                        -- es. riferimento a lettera di incarico/informativa
  creato_il          timestamptz NOT NULL DEFAULT now(),
  aggiornato_il      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. REGISTRO DELEGHE
-- ---------------------------------------------------------------------
CREATE TABLE deleghe (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id         uuid NOT NULL REFERENCES clienti(id) ON DELETE RESTRICT,
  tipo               tipo_delega NOT NULL,
  data_inizio        date NOT NULL,
  data_scadenza      date NOT NULL,
  revocata_il        date,
  riferimento_doc    text,                        -- percorso/ID del documento di delega
  creato_il          timestamptz NOT NULL DEFAULT now(),
  CHECK (data_scadenza >= data_inizio),
  CHECK (revocata_il IS NULL OR revocata_il >= data_inizio)
);
CREATE INDEX idx_deleghe_cliente_tipo ON deleghe (cliente_id, tipo);

-- ---------------------------------------------------------------------
-- 4. CATALOGO DOCUMENTI (minimizzazione + retention per tipo)
--    Si scarica SOLO cio' che e' presente in questo catalogo e attivo.
-- ---------------------------------------------------------------------
CREATE TABLE tipi_documento (
  codice             text PRIMARY KEY,            -- es. 'CU', 'F24', 'DICHIARAZIONE_REDDITI'
  descrizione        text NOT NULL,
  delega_richiesta   tipo_delega NOT NULL,
  canale_preferito   canale_scarico NOT NULL DEFAULT 'api_ufficiale',
  retention_anni     smallint NOT NULL CHECK (retention_anni BETWEEN 1 AND 20),
  finalita           text NOT NULL,               -- finalita' del trattamento (art. 5 GDPR)
  attivo             boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- 5. AUDIT LOG APPEND-ONLY CON HASH CHAIN
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  ts            timestamptz NOT NULL DEFAULT now(),
  attore        text NOT NULL,                    -- utente umano o servizio
  azione        text NOT NULL,                    -- es. 'job.creato', 'job.avviato', 'documento.scaricato'
  cliente_id    uuid,
  oggetto_tipo  text,
  oggetto_id    text,
  dettagli      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- MAI credenziali, token, cookie
  hash_prec     bytea,
  hash          bytea NOT NULL
);

CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger AS $$
DECLARE
  prev bytea;
BEGIN
  -- serializza gli inserimenti per mantenere la catena coerente
  PERFORM pg_advisory_xact_lock(727001);
  SELECT hash INTO prev FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.hash_prec := prev;
  NEW.hash := digest(
    coalesce(encode(prev, 'hex'), '') ||
    NEW.ts::text || NEW.attore || NEW.azione ||
    coalesce(NEW.cliente_id::text, '') ||
    coalesce(NEW.oggetto_tipo, '') || coalesce(NEW.oggetto_id, '') ||
    NEW.dettagli::text,
    'sha256');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

CREATE OR REPLACE FUNCTION audit_log_immutabile() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log e'' append-only: % non consentito', TG_OP;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutabile();
CREATE TRIGGER trg_audit_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutabile();

-- Verifica periodica dell'integrita' della catena (restituisce righe corrotte)
CREATE OR REPLACE FUNCTION audit_verifica_catena()
RETURNS TABLE (id_corrotto bigint) AS $$
  SELECT a.id
  FROM audit_log a
  LEFT JOIN audit_log p ON p.id = (SELECT max(id) FROM audit_log WHERE id < a.id)
  WHERE a.hash_prec IS DISTINCT FROM p.hash
     OR a.hash <> digest(
          coalesce(encode(a.hash_prec, 'hex'), '') ||
          a.ts::text || a.attore || a.azione ||
          coalesce(a.cliente_id::text, '') ||
          coalesce(a.oggetto_tipo, '') || coalesce(a.oggetto_id, '') ||
          a.dettagli::text, 'sha256');
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- 6. CONTROLLO DELEGA (prima difesa: nessun job senza delega valida)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delega_valida(p_cliente uuid, p_tipo_doc text, p_data date DEFAULT current_date)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tipi_documento t
    JOIN deleghe d ON d.tipo = t.delega_richiesta
    JOIN clienti c ON c.id = d.cliente_id
    WHERE t.codice = p_tipo_doc
      AND t.attivo
      AND d.cliente_id = p_cliente
      AND c.incarico_attivo
      AND p_data BETWEEN d.data_inizio AND d.data_scadenza
      AND (d.revocata_il IS NULL OR d.revocata_il > p_data)
  );
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- 7. JOB DI SCARICO
-- ---------------------------------------------------------------------
CREATE TABLE job (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id         uuid NOT NULL REFERENCES clienti(id),
  tipo_documento     text NOT NULL REFERENCES tipi_documento(codice),
  anno_riferimento   smallint,
  canale             canale_scarico NOT NULL,
  stato              stato_job NOT NULL DEFAULT 'in_coda',
  richiesto_da       text NOT NULL,               -- utente nominale, mai account condivisi
  pianificato_per    timestamptz NOT NULL DEFAULT now(),
  iniziato_il        timestamptz,
  terminato_il       timestamptz,
  tentativi          smallint NOT NULL DEFAULT 0,
  ultimo_errore      text,                        -- senza dati sensibili
  creato_il          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_coda ON job (stato, pianificato_per);

-- Blocca la creazione/avvio se la delega non e' valida
CREATE OR REPLACE FUNCTION job_controllo_delega() RETURNS trigger AS $$
BEGIN
  IF NEW.stato IN ('in_coda', 'in_esecuzione') AND NOT delega_valida(NEW.cliente_id, NEW.tipo_documento) THEN
    NEW.stato := 'bloccato_delega';
    INSERT INTO audit_log (attore, azione, cliente_id, oggetto_tipo, oggetto_id, dettagli)
    VALUES (coalesce(NEW.richiesto_da, 'sistema'), 'job.bloccato_delega', NEW.cliente_id, 'job',
            NEW.id::text, jsonb_build_object('tipo_documento', NEW.tipo_documento));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_delega
  BEFORE INSERT OR UPDATE OF stato ON job
  FOR EACH ROW EXECUTE FUNCTION job_controllo_delega();

-- Un solo job in esecuzione alla volta (concorrenza 1, nessun accesso massivo parallelo)
CREATE UNIQUE INDEX uq_un_solo_job_in_esecuzione
  ON job ((true)) WHERE stato = 'in_esecuzione';

-- Estrazione sicura del prossimo job (da usare dal worker)
CREATE OR REPLACE FUNCTION prossimo_job() RETURNS job AS $$
DECLARE
  j job;
BEGIN
  SELECT * INTO j FROM job
  WHERE stato = 'in_coda' AND pianificato_per <= now()
  ORDER BY pianificato_per
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    UPDATE job SET stato = 'in_esecuzione', iniziato_il = now(), tentativi = tentativi + 1
    WHERE id = j.id RETURNING * INTO j;
  END IF;
  RETURN j;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 8. DOCUMENTI SCARICATI (idempotenza via hash + retention)
-- ---------------------------------------------------------------------
CREATE TABLE documenti (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES job(id),
  cliente_id         uuid NOT NULL REFERENCES clienti(id),
  tipo_documento     text NOT NULL REFERENCES tipi_documento(codice),
  anno_riferimento   smallint,
  sha256             bytea NOT NULL,
  percorso_nextcloud text NOT NULL,
  dimensione_byte    bigint,
  scaricato_il       timestamptz NOT NULL DEFAULT now(),
  scadenza_conservazione date,                    -- calcolata dal trigger
  UNIQUE (cliente_id, tipo_documento, anno_riferimento, sha256)  -- no riscarichi duplicati
);

CREATE OR REPLACE FUNCTION documenti_calcola_retention() RETURNS trigger AS $$
DECLARE
  anni smallint;
BEGIN
  SELECT retention_anni INTO anni FROM tipi_documento WHERE codice = NEW.tipo_documento;
  NEW.scadenza_conservazione := (coalesce(NEW.anno_riferimento, extract(year FROM now())::int) + anni + 1 || '-12-31')::date;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documenti_retention
  BEFORE INSERT ON documenti
  FOR EACH ROW EXECUTE FUNCTION documenti_calcola_retention();

-- ---------------------------------------------------------------------
-- 9. VISTE OPERATIVE
-- ---------------------------------------------------------------------
CREATE VIEW v_deleghe_in_scadenza AS
SELECT c.denominazione, c.codice_fiscale, d.tipo, d.data_scadenza,
       (d.data_scadenza - current_date) AS giorni_residui
FROM deleghe d
JOIN clienti c ON c.id = d.cliente_id
WHERE c.incarico_attivo
  AND d.revocata_il IS NULL
  AND d.data_scadenza BETWEEN current_date AND current_date + 60
ORDER BY d.data_scadenza;

CREATE VIEW v_clienti_senza_delega AS
SELECT c.id, c.denominazione, t.codice AS tipo_documento
FROM clienti c
CROSS JOIN tipi_documento t
WHERE c.incarico_attivo AND t.attivo AND NOT delega_valida(c.id, t.codice);

-- Documenti da cancellare/rivedere (retention scaduta o incarico cessato)
CREATE VIEW v_documenti_da_rivedere AS
SELECT d.id, c.denominazione, d.tipo_documento, d.anno_riferimento,
       d.percorso_nextcloud, d.scadenza_conservazione
FROM documenti d
JOIN clienti c ON c.id = d.cliente_id
WHERE d.scadenza_conservazione < current_date;

-- ---------------------------------------------------------------------
-- 10. PERMESSI
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON clienti, deleghe, tipi_documento TO app_orchestratore;
GRANT SELECT, INSERT, UPDATE ON job TO app_orchestratore;
GRANT SELECT ON documenti TO app_orchestratore;
GRANT INSERT ON audit_log TO app_orchestratore, app_worker;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO app_orchestratore, app_worker;

GRANT SELECT ON clienti, deleghe, tipi_documento TO app_worker;
GRANT SELECT, UPDATE (stato, iniziato_il, terminato_il, tentativi, ultimo_errore) ON job TO app_worker;
GRANT INSERT, SELECT ON documenti TO app_worker;

GRANT SELECT ON audit_log TO app_auditor;
GRANT SELECT ON v_deleghe_in_scadenza, v_clienti_senza_delega, v_documenti_da_rivedere TO app_orchestratore, app_auditor;

-- ---------------------------------------------------------------------
-- 11. DATI DI ESEMPIO PER IL CATALOGO (da adattare)
-- ---------------------------------------------------------------------
INSERT INTO tipi_documento (codice, descrizione, delega_richiesta, canale_preferito, retention_anni, finalita) VALUES
 ('CU',   'Certificazione Unica',          'dichiarazioni',   'api_ufficiale',      10, 'Adempimenti dichiarativi del cliente'),
 ('F24',  'Modelli F24 / versamenti',      'f24_versamenti',  'browser_automation', 10, 'Verifica versamenti e riconciliazioni'),
 ('DICH', 'Dichiarazioni dei redditi/IVA', 'dichiarazioni',   'browser_automation', 10, 'Adempimenti dichiarativi del cliente')
ON CONFLICT DO NOTHING;
