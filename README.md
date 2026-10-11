# Studio Open — strumenti e giochi

Due piccole applicazioni in italiano da scaricare e utilizzare nel browser, senza account o installazione di un server.

## Cosa trovi

| Programma | Cosa fa | Per chi |
|---|---|---|
| **Calcolatrice con nastro** | Quattro operazioni, priorità di moltiplicazione e divisione, numeri decimali e negativi, cronologia della sessione | Chi vuole controllare i passaggi di calcoli semplici |
| **Forza 4 Neon** | Gioco contro il computer, scelta della difficoltà e del primo giocatore, annullamento della mossa | Chi vuole giocare dal browser con mouse, tastiera o touch |

## Scarica e avvia

1. Apri [Releases](https://github.com/zivegol/studio-open/releases) e scarica `studio-open-0.1.0.zip`.
2. Estrai **tutto** l’archivio in una cartella.
3. Apri `index.html` con un browser recente e scegli il programma.

In alternativa usa **Code → Download ZIP**. Tutti i sorgenti HTML, CSS e JavaScript sono inclusi e leggibili nei file delle due app. Non occorrono Node.js, PHP, Nextcloud o chiavi API. Le applicazioni non caricano librerie, font o dati da Internet.

## Uso e limiti

- **Calcolatrice:** numeri e operatori dalla tastiera o dai pulsanti; Invio calcola, Esc pulisce il display, Backspace cancella l’ultimo carattere. Il nastro dura solo nella scheda corrente. La precisione visualizzata è limitata a 14 cifre significative: non è un motore contabile a precisione decimale esatta. Nessun salvataggio automatico.
- **Forza 4:** seleziona una colonna e premi Rilascia pedina. Frecce destra/sinistra per spostarti, Invio o freccia giù per giocare. Non sono previsti multiplayer online, account o salvataggio delle partite.
- Versione iniziale **0.1.0**: verifiche indicate in CHANGELOG.md. Nessuna garanzia di idoneità a uno specifico impiego.

## Licenza

Copyright (C) 2026 zivegol e contributori. **GNU GPL versione 3 soltanto — GPL-3.0-only**, testo completo in [LICENSE](LICENSE).

Puoi usare e modificare il codice, anche commercialmente, rispettando la licenza. Se distribuisci versioni modificate, devi rispettarne gli obblighi relativi a sorgente, avvisi e stessa licenza. Non è previsto un obbligo di inviare le modifiche a questo repository. Il software è fornito senza garanzia nei termini della licenza.

## Come viene mantenuto

Questo repository è la **vetrina di distribuzione**, generata dai sorgenti ufficiali del progetto Studio Apps. Non contiene la cronologia privata, i servizi dello studio o dati dei clienti. SOURCE.json identifica il commit di origine e gli hash dei sorgenti inclusi. Lo sviluppo rimane nella cartella ufficiale; gli aggiornamenti vengono esportati qui dopo le verifiche.

Per segnalare un problema, descrivi browser, passaggi e risultato atteso senza inserire dati personali. La disponibilità del codice non comprende un servizio di assistenza garantito.
