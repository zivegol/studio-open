-- Correzioni emerse scrivendo il servizio: senza queste, worker e orchestratore
-- non riescono a scrivere nel registro (il trigger della catena legge audit_log).
ALTER FUNCTION audit_log_chain() SECURITY DEFINER SET search_path = public, pg_temp;
GRANT UPDATE (pianificato_per) ON job TO app_worker;      -- backoff dopo un errore
GRANT SELECT ON audit_log TO app_orchestratore;           -- la dashboard mostra il registro
