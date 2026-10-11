# Runbook operativo

## Installazione iniziale

1. Creare DNS e rete Docker esterna `public_proxy`.
2. Copiare `.env.example` in `.env` sul server e valorizzarlo fuori da Git.
3. Registrare il client OIDC con redirect esatto `/api/oauth/callback`; inserire i `sub` autorizzati.
4. Eseguire `docker compose build` e `docker compose up -d`.
5. Verificare `docker compose ps`, `/healthz`, login, upload/download e PWA su HTTPS.

## Aggiornamento reversibile

1. Creare backup DB e snapshot/backup del volume oggetti.
2. Salvare l'immagine in uso e annotare il tag release.
3. Provare migrazioni e test in staging.
4. Eseguire `docker compose build` e `docker compose up -d` in finestra di manutenzione.
5. Verificare health, login, sessione di prova, budget e allegato.

Rollback: ripristinare l'immagine precedente. Se la migration non è compatibile, fermare `agora-web`, ripristinare il dump DB e il backup oggetti coordinato, quindi avviare la release precedente. La migration `0016` può essere annullata eliminando prima `external_identities` e poi le quattro colonne aggiunte a `session_attachments`, soltanto dopo backup verificato.

## Backup e restore

Eseguire ogni giorno un dump MariaDB cifrato e un backup/versioning cifrato del bucket. Conservare segreti e chiavi di cifratura separatamente. Definire retention prima della produzione. Ogni mese ripristinare in staging e confrontare conteggi di utenti, sessioni, run, voti, allegati e costi; verificare anche checksum e dimensione di almeno un oggetto.

## TLS e incidenti

Caddy rinnova automaticamente TLS: monitorare scadenza e log del proxy. In caso di sospetta compromissione: isolare `agora-web`, conservare log sanitizzati, revocare sessioni cambiando `SESSION_SECRET`, ruotare credenziali OIDC/S3/DB e chiavi provider, valutare la rotazione cifrata di `AGORA_ENCRYPTION_KEY`, ripristinare da backup noto e documentare impatto e utenti coinvolti.
