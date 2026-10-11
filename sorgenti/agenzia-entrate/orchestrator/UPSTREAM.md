# Servizio cassetto fiscale (orchestratore API + worker)

## Avvio di prova (modalità mock, nessun contatto con l'Agenzia delle Entrate)
1. `mkdir secrets && cd secrets` e crea i file: `pg_admin`, `pg_orchestratore`, `pg_worker`, `pg_auditor`
   (password alfanumeriche: `openssl rand -hex 24 > pg_worker`), `nc_app_password` (password per app
   di un utente Nextcloud dedicato), `vault_role_id`, `vault_secret_id`, `vault_ca.crt`
   (in mock gli ultimi tre possono contenere testo qualsiasi).
2. Esporta `NC_USER=<utente dedicato>` e lancia `docker compose up -d --build`.
3. Inserisci clienti e deleghe di prova (vedi sotto) e crea job dall'API.

Dati di prova (psql come superutente):
    INSERT INTO clienti(codice_fiscale,denominazione) VALUES ('DEMO0001','Alfa Meccanica Srl');
    INSERT INTO deleghe(cliente_id,tipo,data_inizio,data_scadenza)
      SELECT id,'dichiarazioni',current_date,current_date+365 FROM clienti WHERE codice_fiscale='DEMO0001';
    -- stessa cosa con tipo 'f24_versamenti'

## Cosa verificare
- Job con delega valida: completato, file `.txt` in `Clienti-AdE/<CF>_<nome>/<anno>/` su Nextcloud.
- Job con delega revocata o scaduta: resta `bloccato_delega`.
- Canale browser: il primo job va in `attesa_autenticazione`; `POST /api/job/<id>/resume` lo rimette in coda.
- Stesso documento due volte: `documento.duplicato`, nessun secondo file.
- `GET /api/audit/verifica`: `integra: true`.

## Collegamento reale
Implementa `src/downloaders/api_ufficiale.js` e `browser.js` (contratto nei commenti), crea i segreti in Vault
(`secret/studio/ade/modi`, `.../entratel`) e passa `DOWNLOADER_MODE=reale`. Alza le pause tra i job.
