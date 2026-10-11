# Cassetto Studio — sorgenti pubblici preliminari

Scrivania per organizzare documenti fiscali, consultazioni del cassetto fiscale, F24, richieste CU e registro interno delle deleghe. Comprende interfaccia Nextcloud, gateway PHP e connettore browser.

## Requisiti

Nextcloud, PHP, database, gateway configurati e worker Node/Playwright. Per i collegamenti reali servono credenziali, certificati e autorizzazioni proprie. Scaricare il codice non attribuisce alcun accesso ai servizi dell'Agenzia delle Entrate.

## Struttura e avvio tecnico

- `web/`: interfaccia senza build, da integrare al percorso `/studio-apps/agenzia-entrate/`.
- `server/`: gateway autenticati Nextcloud; configurare la route `/studio-ade-api` al gateway, mantenendo configurazioni e segreti fuori dai sorgenti.
- `connector/`: worker Playwright; leggere il Dockerfile e `compose.yml`. Richiede una rete Nextcloud e un volume separato per i segreti. Non esporre la porta del worker su Internet.
- `orchestrator/`: codice sperimentale di API/coda/worker, con modalità mock; `UPSTREAM.md` descrive il prototipo. Non è un componente certificato né una sostituzione già integrata di tutti i gateway.
- `docs/INTEGRATION.md`: dettagli del collegamento tecnico.

I segnaposto `DEMO...`, domini `studio.example` e utenti di esempio devono essere sostituiti o rimossi. Gli archivi dossier e le tabelle delle integrazioni precedenti non sono inclusi: questo **non è un plugin Nextcloud installabile con un clic**. Gli script di deployment dello studio e i test con sessioni reali sono esclusi.

## Stato e limiti

**0.2.0-preview — consultazione e sviluppo.** Non effettuare prove su contribuenti reali per verificare una nuova installazione. Le deleghe dell'interfaccia sono registrazioni interne: non conferiscono né modificano autorizzazioni sul portale. Il recupero effettivo dei documenti richiede collaudo di ciascun percorso con le proprie autorizzazioni. Esiti tecnici in `../../VERIFICHE.md`.

## Licenza

Codice originale AGPL-3.0-only. Dipendenze esterne conservano le loro licenze. Nessun certificato, password, archivio fiscale o cronologia privata è incluso.
