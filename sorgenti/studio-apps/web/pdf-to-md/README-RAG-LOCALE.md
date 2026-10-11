# PDF to Markdown per RAG locale

Questa app e' il primo blocco della pipeline:

PDF originale -> Markdown pulito -> indicizzazione RAG locale -> interrogazione con Ollama/Jan

## Stato attuale

- conversione lato browser, senza inviare i PDF a server esterni;
- `pdf.js` e worker sono salvati localmente in `vendor/pdfjs`;
- output `.md` scaricabile singolarmente o in batch;
- frontmatter YAML per metadati;
- marker opzionali `CHUNK_N_START` / `CHUNK_N_END`;
- pulizia header/footer ripetuti basata sulle righe estratte dalle pagine.

## Limiti

- funziona con PDF testuali nativi;
- non fa OCR su scansioni;
- non indicizza ancora in automatico dentro un vector database;
- non interroga direttamente Ollama/Jan.

## Fase successiva consigliata

Creare un servizio Docker separato da Nextcloud che:

1. legge una cartella Nextcloud dedicata, ad esempio `RAG/inbox-md`;
2. carica i file `.md`;
3. spezza i documenti in chunk usando i marker o heading Markdown;
4. genera embedding locali con Ollama;
5. salva l'indice in ChromaDB;
6. espone una piccola API locale per interrogazione da Jan o da una futura app HTML.

Cartelle suggerite:

- `RAG/pdf-originali`
- `RAG/md-convertiti`
- `RAG/indice-chroma`

