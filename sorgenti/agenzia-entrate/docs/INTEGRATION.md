# Integrazione della struttura orchestratore/worker

I due pacchetti forniti dall'utente sono ricomposti in `orchestrator/` secondo gli import effettivi. `UPSTREAM.md` descrive la proposta originale, non il collaudo di questa versione. La dashboard di esempio con dati fittizi non viene installata nell'app dello studio.

Correzioni: lavori interrotti in `da_verificare`; nessun reinvio automatico dopo un errore dall'esito incerto; catalogo dei documenti remoti distinto dall'archivio; collegamento documento-job e deduplicazione prima del download per documenti già archiviati e identificati; ID audit assegnati sotto lock e timestamp UTC canonico; password PostgreSQL letta da file senza esportarla nell'ambiente; timeout Vault/WebDAV; provider segreti Docker o Vault.

`sql/005_remote_catalog.sql` cambia il formato degli hash: applicarlo solo al nuovo database vuoto. Non applicarlo al registro Nextcloud esistente né a catene storiche senza una migrazione esplicita.

## Confini della prima installazione

L'app Nextcloud usa ancora il gateway e i collegamenti API preesistenti. La nuova struttura PostgreSQL è collaudata separatamente e non riceve documenti o credenziali reali. I downloader upstream sono punti di innesto che falliscono esplicitamente: non sostituire con essi le integrazioni attive. Non è ancora collegata alla sessione personale del connettore.

L'integrazione in produzione della coda richiede: binding server-side del catalogo ai documenti osservati; identità operatore/cliente controllata a ogni azione; prova reale con una singola delega; riconciliazione esito remoto dopo interruzione; scelta e configurazione del provider segreti. Un semplice clic “accesso confermato” non prova l'autenticazione del browser.

Il registro deleghe della nuova interfaccia è interno per utente Nextcloud; non è ancora la sorgente del controllo SQL del servizio separato. Questi registri vanno unificati prima dell'abilitazione della coda reale. Fino ad allora nessun job della nuova coda deve contattare l'Agenzia.

Non sono dichiarati collaudati: Vault reale, accesso Agenzia, flussi di CU massivo, catalogo completo per ciascuna tipologia, download end-to-end. I test SQL e UI utilizzano soltanto dati sintetici.
