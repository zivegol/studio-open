# Studio Open — app, strumenti e giochi

Catalogo pubblico dei programmi di zivegol, con sorgenti scaricabili, descrizioni e requisiti. **Reguso e NC Scuola sono esclusi.** I servizi e gli archivi dello studio non sono accessibili da questo repository.

| Progetto | Cosa fa | Disponibilità |
|---|---|---|
| [Calcolatrice con nastro](calcolatrice/calcolatrice.html) | Quattro operazioni e cronologia della sessione | Browser, anche offline |
| [Forza 4 Neon](giochi/forza4_neon.html) | Gioco contro il computer con tre difficoltà | Browser, anche offline |
| [App Studio — catalogo completo](sorgenti/studio-apps/README.md) | Locazioni, parcelle, adempimenti, dossier, PDF, mutui, pianificazione, analisi contabili, verbali, utilità e giochi | Sorgenti preliminari; alcuni moduli autonomi, altri richiedono Nextcloud/PHP/Python |
| [Agorà AI](sorgenti/agora-ai/README.md) | Confronta risposte di più modelli AI, organizza dibattiti e sintesi con controllo dei costi | Node, database, OIDC, S3 e chiavi AI proprie |
| [Revisore Nano](sorgenti/revisore-nano/README.md) | Organizza incarichi di revisione, documenti, schede e verifiche contabili | Sorgenti preliminari con problemi noti; Node, MySQL, HTTPS e integrazioni |
| [Cassetto Studio — Agenzia Entrate](sorgenti/agenzia-entrate/README.md) | Scrivania fiscale, documenti, F24, CU e registro interno deleghe | Codice di integrazione preliminare; Nextcloud, PHP, worker e autorizzazioni proprie |

Le schede descrivono funzioni, requisiti e limiti **prima dello scarico**. Esiti dei controlli in [VERIFICHE.md](VERIFICHE.md).

## Scarica e avvia

Apri [la release 0.2.0-preview](https://github.com/zivegol/studio-open/releases/tag/v0.2.0-preview), scarica **studio-open-0.2.0-preview.zip** ed estrai tutto. In alternativa usa **Code → Download ZIP** per l'ultima revisione.

- Per Calcolatrice e Forza 4 apri `index.html`: nessun server o account necessario.
- Per gli altri programmi leggi la scheda in `sorgenti/<progetto>/`. Scaricare i sorgenti non installa automaticamente i servizi.
- La [versione 0.1.0](https://github.com/zivegol/studio-open/releases/tag/v0.1.0) contiene soltanto i due programmi autonomi.

La raccolta 0.2.0-preview è destinata a consultazione e sviluppo: **non è una release complessiva stabile** né un installer universale. Le nuove installazioni complete dei servizi non sono state collaudate. Non servire l'intera cartella dei sorgenti come sito web: contiene anche codice server.

Calcolatrice: Invio calcola, Esc pulisce, Backspace cancella un carattere. Precisione limitata a 14 cifre significative in virgola mobile: non sostituisce un sistema contabile esatto. Forza 4: frecce per scegliere la colonna, Invio o freccia giù per giocare. Nastro e partite non vengono salvati.

## Licenze

Copyright (C) 2026 zivegol e contributori. Calcolatrice e giochi: **GPL-3.0-only**. Codice originale dei progetti sotto `sorgenti/`: **AGPL-3.0-only**, salvo le eccezioni indicate nelle rispettive cartelle. I componenti di terzi mantengono le proprie licenze. Leggere LICENSE, LICENSING.md e THIRD-PARTY.md del progetto. Software fornito senza garanzia nei termini delle licenze.

## Manutenzione

Distribuzione generata dai repository ufficiali di sviluppo, senza cronologia privata, database, credenziali o documenti dei clienti. I riferimenti dello studio sono sostituiti con esempi; trasformazioni e hash sono registrati in `sorgenti/SOURCE-MANIFEST.json`. I segnaposto non sono una configurazione funzionante. `SOURCE.json` documenta separatamente i due programmi autonomi.

Per segnalare problemi indicare versione, ambiente e passaggi, senza dati personali o chiavi. Nessun servizio di assistenza garantito.
