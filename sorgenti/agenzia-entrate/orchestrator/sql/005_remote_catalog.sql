-- Remote availability is distinct from an archived file. Never store session URLs.
CREATE TABLE documenti_remoti (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cliente_id uuid NOT NULL REFERENCES clienti(id),
 tipo_documento text NOT NULL REFERENCES tipi_documento(codice),
 anno_riferimento smallint NOT NULL,
 identificativo_remoto text NOT NULL CHECK (length(identificativo_remoto) BETWEEN 1 AND 300),
 versione_remota text NOT NULL DEFAULT '',
 etichetta text NOT NULL,
 osservato_il timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cliente_id,tipo_documento,identificativo_remoto,versione_remota)
);
ALTER TABLE job ADD COLUMN documento_remoto_id uuid REFERENCES documenti_remoti(id);
ALTER TABLE documenti ADD COLUMN documento_remoto_id uuid REFERENCES documenti_remoti(id);
CREATE UNIQUE INDEX uq_documento_remoto_archiviato ON documenti(documento_remoto_id) WHERE documento_remoto_id IS NOT NULL;
CREATE UNIQUE INDEX uq_job_documento_attivo ON job(documento_remoto_id) WHERE documento_remoto_id IS NOT NULL AND stato IN ('in_coda','in_esecuzione','attesa_autenticazione','da_verificare');
GRANT SELECT,INSERT,UPDATE ON documenti_remoti TO app_orchestratore;
GRANT SELECT ON documenti_remoti TO app_worker;

-- The lock precedes ID allocation: concurrent inserts must keep chain order.
CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger AS $$
DECLARE prev bytea;
BEGIN
 PERFORM pg_advisory_xact_lock(727001);
 NEW.id := nextval('audit_log_id_seq');
 SELECT hash INTO prev FROM audit_log ORDER BY id DESC LIMIT 1;
 NEW.hash_prec := prev;
 NEW.hash := digest(jsonb_build_array(encode(prev,'hex'),NEW.id,
 to_char(NEW.ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
 NEW.attore,NEW.azione,NEW.cliente_id,NEW.oggetto_tipo,NEW.oggetto_id,NEW.dettagli)::text,'sha256');
 RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp;

CREATE OR REPLACE FUNCTION audit_verifica_catena() RETURNS TABLE(id_corrotto bigint) AS $$
 SELECT a.id FROM audit_log a
 LEFT JOIN audit_log p ON p.id=(SELECT max(id) FROM audit_log WHERE id<a.id)
 WHERE a.hash_prec IS DISTINCT FROM p.hash OR a.hash<>digest(jsonb_build_array(
 encode(a.hash_prec,'hex'),a.id,to_char(a.ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
 a.attore,a.azione,a.cliente_id,a.oggetto_tipo,a.oggetto_id,a.dettagli)::text,'sha256');
$$ LANGUAGE sql STABLE;
-- This migration is for the new empty service, not existing audit chains.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION prossimo_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prossimo_job() TO app_worker;
