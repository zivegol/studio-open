# Installazione self-hosted

Agorà resta separata da Nextcloud e viene pubblicata su un sottodominio HTTPS. Per il pilota può condividere lo stesso host Linux, purché CPU, RAM e disco siano verificati.

## Prerequisiti

- Docker Engine con Compose v2 e rete esterna `public_proxy`;
- DNS del sottodominio diretto al reverse proxy;
- provider OIDC e client con Authorization Code + PKCE;
- almeno un backup esterno cifrato.

## Avvio

1. Copiare il repository privato sul server e creare `.env` da `.env.example` con permessi `0600`.
2. Generare valori casuali distinti per password, `SESSION_SECRET` e `AGORA_ENCRYPTION_KEY`.
3. Inserire in `OIDC_ALLOWED_SUBJECTS` il `sub` del titolare e, solo se necessario, quelli dei colleghi.
4. Adattare `deploy/Caddyfile.example` al dominio reale.
5. Eseguire `docker network create public_proxy` se la rete non esiste, quindi `docker compose up -d --build`.
6. Verificare `/healthz` e completare `docs/ACCEPTANCE-CHECKLIST.md`.

Il titolare configura le chiavi AI dall'interfaccia. I colleghi autorizzati possono usarle ma non leggerle o modificarle; sessioni, allegati e statistiche restano individuali.

## Documenti Nextcloud ed esterni

Il file picker accetta un file esterno oppure un file presente nella cartella Nextcloud sincronizzata sul dispositivo. L'utente indica l'origine e, per ogni caricamento, sceglie `anonimizzato` o `non anonimizzato`. Nessuna cartella Nextcloud è montata nel container e nessun documento viene acquisito automaticamente.

## Migrazione

Applicare le migration Drizzle prima dell'avvio. Migrare dati non sensibili solo dopo backup verificato e confronto dei conteggi. Copiare gli oggetti nel bucket privato usando chiavi `users/<id>/attachments/<uuid>/...`, verificando checksum e dimensione. Le vecchie chiavi API devono essere reinserite dal titolare; non esportarle in chiaro.
