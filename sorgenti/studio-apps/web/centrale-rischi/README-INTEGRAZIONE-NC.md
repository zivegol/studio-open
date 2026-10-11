# Centrale Rischi - integrazione studio-example / NC

## File applicazione

- `centrale_rischi_storica.html`: frontend della dashboard.
- `centrale_rischi_server.py`: micro-endpoint opzionale per estrarre testo dai PDF con `pypdf`.

## Catalogo studio-example

La voce e stata aggiunta in:

- `../apps.nextcloud.js`
- `../apps.docker.js`
- `../apps.js` per il test locale Nextcloud-like

Per deploy Docker, copiare `apps.docker.js` come `/studio-apps/apps.js`.

URL applicazione:

```text
centrale-rischi/centrale_rischi_storica.html
```

## Endpoint PDF

Il frontend prova prima l'endpoint relativo:

```text
api/extract-pdf
```

Se la pagina e servita da:

```text
/studio-apps/centrale-rischi/centrale_rischi_storica.html
```

la richiesta diventa:

```text
/studio-apps/centrale-rischi/api/extract-pdf
```

In NC va quindi configurato un reverse proxy o una route applicativa che inoltri quel path al servizio Python.

## Avvio locale di test

```powershell
pip install pypdf
python centrale_rischi_server.py 8788
```

Poi aprire:

```text
http://127.0.0.1:8788/centrale_rischi_storica.html
```

## Note per produzione

- L'HTML funziona anche senza backend, ma l'import PDF via browser puo essere meno affidabile.
- Per produzione NC e preferibile usare sempre estrazione server-side.
- Il parser restituisce righe normalizzate in memoria: mese, banca gruppo, banca originale, forma tecnica, categoria, accordato operativo, utilizzato, sconfinamento, stato.
- Step successivo consigliato: persistere le righe in DB studio-example per riaprire analisi e report senza ricaricare il PDF.
