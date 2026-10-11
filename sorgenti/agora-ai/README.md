# Agorà AI — sorgenti pubblici preliminari

Spazio di lavoro per confrontare risposte di più modelli AI a un quesito, organizzare un dibattito e produrre una sintesi, anche a partire da documenti allegati. Include cronologia, stime di costo, limiti di budget e configurazione dei provider.

## Requisiti

Node.js, pnpm 10.4.1, database MySQL/MariaDB, storage S3/MinIO, provider OIDC e reverse proxy HTTPS. Il progetto include Dockerfile, Compose e lockfile. Le chiavi dei servizi AI sono personali e possono comportare costi; non sono incluse.

## Avvio di sviluppo

1. Leggere `INSTALL.md` e `SECURITY.md`.
2. Copiare `.env.example` in `.env` e sostituire tutti i segnaposto con valori propri. Generare segreti distinti; non mettere chiavi nelle variabili `VITE_*`.
3. Installare con `pnpm install --frozen-lockfile` e predisporre un database e un bucket nuovi, senza dati reali.
4. Valutare le migrazioni prima dell'applicazione: il progetto contiene una baseline e migrazioni storiche, che non vanno applicate entrambe indiscriminatamente. Usare il percorso documentato per il proprio caso.
5. Eseguire `pnpm check`, `pnpm test`, `pnpm build`; avviare il server con HTTPS e completare `docs/ACCEPTANCE-CHECKLIST.md`.

Su PowerShell i comandi npm con assegnazione POSIX `NODE_ENV=...` richiedono l'equivalente `$env:NODE_ENV = 'development'` seguito da `pnpm exec tsx watch server/_core/index.ts`.

## Dati e servizi esterni

Prompt e contenuti dei documenti selezionati possono essere trasmessi ai provider AI scelti per l'elaborazione. OIDC gestisce l'accesso; database e S3 conservano contenuti dell'istanza. Il programma non monta automaticamente l'archivio Nextcloud. Consultare `docs/data-and-documents.md` prima di inserire documenti riservati.

## Stato e licenza

**0.2.0-preview: codice per consultazione, sviluppo e valutazione tecnica.** La disponibilità del sorgente non attiva un servizio AI né garantisce una nuova installazione completa OIDC/S3/provider. Verifiche e limiti in `../../VERIFICHE.md`.

Codice originale AGPL-3.0-only, con preservazione dei diritti già concessi alle copie precedenti. Dipendenze e componenti UI mantengono le proprie licenze: `LICENSE`, `LICENSING.md`, `THIRD-PARTY.md`. Cronologia privata, credenziali, conversazioni e script operativi specifici sono esclusi.
