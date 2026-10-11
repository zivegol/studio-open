# App Studio — sorgenti pubblici preliminari

Raccolta di strumenti in italiano per documenti, contabilità, pianificazione e utilità, con giochi browser. Questa cartella contiene codice consultabile e modificabile: non è una copia del server dello studio e non contiene archivi clienti.

## Cosa trovi

| Modulo | Cosa fa | Requisiti e limiti |
|---|---|---|
| Contratti di locazione | Compila bozze con parti, immobili, clausole e allegati; esporta JSON, Word HTML e stampa | `web/locazioni/compilatore.html`; testi da verificare prima dell'uso. Gestionale separato in `index.html`, con Nextcloud e SQLite |
| Parcelle e fatture | Documenti di parcella e strumenti FatturaPA | PHP, archivi e servizi Nextcloud da configurare |
| Adempimenti | Organizza attività e scadenze dello studio | Integrazioni Nextcloud; nessuna scadenza professionale certificata |
| Dossier clienti | Riunisce anagrafiche e documenti | Archivio Nextcloud proprio, autorizzazioni e generatori dati |
| PDF → Excel / Markdown | Estrae dati e testo per elaborazioni successive | Browser e librerie PDF; integrazioni server per alcune funzioni. Verificare l'estrazione |
| RAG locale | Consultazione documentale con ricerca e indicizzazione | Servizi RAG e modelli da installare separatamente |
| PIMS Privacy | Supporta la preparazione della documentazione privacy | Non certifica conformità normativa |
| Mutui | Simula rate e ammortamenti | Browser; libreria Excel esterna. Simulazioni da verificare |
| Business plan / Previsione di chiusura | Organizza ipotesi e prospetti previsionali | Browser e librerie esterne; risultati dipendenti dagli input |
| IRPEF / Forfettario | Confronta scenari fiscali | Versioni di sviluppo: norme, annualità e formule non validate per questo rilascio |
| Generatore verbali | Compila bozze societarie da modelli | Verificare presupposti e testo. Cessioni richiede backend Python/PHP e configurazione propria |
| Separa M7M | Separa componenti di file firmati | Non valida giuridicamente la firma |
| OmniStat / OmniClient | Analisi statistiche e cruscotti gestionali | Verificare dati, modelli e risultati |
| Centrale rischi | Analizza dati storici della Centrale Rischi | Backend Python e input propri, nessun report reale incluso |
| Bilanci / Infrannuali | Analisi e confronti di bilancio | Dataset da generare e PHP; nessun dataset dello studio incluso |
| Bilanci anonimizzati | Supporta l'anonimizzazione di documenti contabili | Controllare manualmente la rimozione degli identificativi |
| Partitari | Consultazione e analisi dei partitari | Archivio e servizi di condivisione da configurare |
| Calcolatrice | Quattro operazioni e nastro della sessione | Pacchetto autonomo nella radice di Studio Open |
| Giochi | Forza 4, Pong, poker, corse, pallavolo, sparatutto e bolle | File HTML in `web/giochi`; alcuni caricano font esterni |

## Come partire

Per leggere il codice non serve installare nulla. Per i programmi HTML autonomi aprire il relativo file nel browser: alcune funzioni richiedono Internet per librerie o font. Il compilatore locazioni consente il salvataggio locale; il salvataggio Nextcloud richiede un account e WebDAV. Non tutte le pagine HTML sono autonome.

Per i moduli integrati predisporre un ambiente di sviluppo **separato**, Nextcloud, PHP con le estensioni richieste e i backend Python indicati nei sorgenti. Servire `web` al percorso `/studio-apps/`, configurare i gateway PHP fuori dal document root e le relative route. Il gestionale locazioni usa `/studio-core-api?op=locazioni`. Non servire l'intero archivio come cartella pubblica: contiene codice server e configurazioni di esempio.

I domini `studio.example`, gli utenti `studio-example` e i codici `DEMO...` sono segnaposto. Non concedere accessi affidandosi a questi nomi: configurare i controlli per i propri utenti. Nessun database o documento è incluso. I servizi RAG e gli archivi non sono forniti come installazione automatica.

## Stato della versione

**0.2.0-preview — consultazione e sviluppo.** Non è stata eseguita un'installazione completa di tutti i moduli su un nuovo server. Le verifiche svolte sono nel rapporto `../../VERIFICHE.md`. Il catalogo non equivale a una validazione delle formule o dei testi fiscali e contrattuali.

Esclusi: test/stub legati all'ambiente operativo, monitoraggio del server, cronologia privata e dataset geografico del modulo cessioni (anagrafica dei luoghi da fornire separatamente con licenza appropriata). L'assenza di tale dataset limita la compilazione automatica dei luoghi di nascita; il codice del modulo resta consultabile. Reguso e NC Scuola non fanno parte della pubblicazione.

## Licenze

Codice originale AGPL-3.0-only; Calcolatrice e giochi GPL-3.0-only nelle rispettive cartelle. I file delle librerie PDF.js e SheetJS conservano le loro licenze Apache-2.0 e gli avvisi originali. Vedere `THIRD-PARTY.md`. Le altre librerie richiamate da CDN non vengono incluse nell'archivio; i browser contattano quei fornitori quando le caricano.
