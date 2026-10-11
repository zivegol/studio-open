\set ON_ERROR_STOP on
BEGIN;
INSERT INTO clienti(id,codice_fiscale,denominazione) VALUES ('00000000-0000-4000-8000-000000000001','DEMOCLIENT01','Cliente sintetico');
SET ROLE app_orchestratore;
INSERT INTO job(cliente_id,tipo_documento,anno_riferimento,canale,richiesto_da) VALUES ('00000000-0000-4000-8000-000000000001','CU',2025,'api_ufficiale','test');
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM job WHERE stato='bloccato_delega') THEN RAISE EXCEPTION 'delega assente non bloccata'; END IF; END $$;
INSERT INTO deleghe(cliente_id,tipo,data_inizio,data_scadenza) VALUES ('00000000-0000-4000-8000-000000000001','dichiarazioni',current_date,current_date+1);
INSERT INTO job(cliente_id,tipo_documento,anno_riferimento,canale,richiesto_da) VALUES ('00000000-0000-4000-8000-000000000001','CU',2025,'api_ufficiale','test');
SET ROLE app_worker;
SELECT (prossimo_job()).stato;
UPDATE job SET stato='da_verificare' WHERE stato='in_esecuzione';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM job WHERE stato='in_coda') THEN RAISE EXCEPTION 'ripartenza incerta in coda'; END IF; END $$;
INSERT INTO audit_log(attore,azione) VALUES ('worker','test');
RESET ROLE;
SET TIME ZONE 'Pacific/Auckland';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM audit_verifica_catena()) THEN RAISE EXCEPTION 'hash dipendente dal fuso'; END IF; END $$;
SET ROLE app_worker;
DO $$ BEGIN
 BEGIN UPDATE audit_log SET azione='alterata'; RAISE EXCEPTION 'modifica log permessa'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: delega, coda, recupero incerto, ruoli, audit e fuso orario' AS esito;
