# Dati, conversazioni e documenti in Agorà AI

## Dove vengono salvati i dati

Le sessioni del consiglio — tema, risposte iniziali, repliche, dossier o verdetto, consumi e valutazioni — sono registrate nel database dell’app e associate all’utente autenticato. Questo rende la cronologia disponibile dopo chiusura del browser, ricarica della pagina o riavvio del server.

Le chiavi API non vengono restituite al browser dopo il salvataggio: sono conservate cifrate lato server. I costi, i token e i dati della chiave OpenRouter visualizzati nell’interfaccia sono invece metadati di utilizzo o dati restituiti dal provider.

## Allegati documentali

Gli allegati supportati sono **PDF, DOCX, TXT e XLSX**. È possibile preparare fino a cinque file per un consiglio, con un limite iniziale di 10 MB per file. I byte del documento sono salvati nello storage privato dell’app; il database conserva soltanto i metadati, il riferimento allo storage, il proprietario, la sessione collegata e un estratto testuale.

Prima dell’avvio, l’utente sceglie esplicitamente gli allegati da usare. L’app estrae testo leggibile e ne invia agli agenti soltanto un contesto compatto, fino a 12.000 caratteri complessivi. Un documento non selezionato non entra nel prompt degli agenti.

## Isolamento e download

Ogni query, collegamento a sessione e download controlla l’identificativo dell’utente proprietario. Un download autorizzato usa un URL firmato temporaneo generato solo dopo questo controllo; l’URL di storage persistente non viene esposto dalla lista allegati.

> L’isolamento è progettato per account singolo. Prima di aprire l’app a più persone occorre completare il modello multiutente con login individuale e controlli di condivisione espliciti.

## Limiti attuali

L’estrazione considera il testo disponibile nel file. Un PDF scansito senza livello testuale può non essere analizzabile finché non viene aggiunto un OCR. Per fogli Excel, il contesto deriva dalle celle leggibili dei fogli. Gli agenti ricevono gli estratti selezionati, non un accesso diretto e permanente ai documenti nello storage.
