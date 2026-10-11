# Revisore Nano — sorgenti pubblici preliminari

Applicazione per organizzare clienti e incarichi di revisione, documenti, fasi di lavoro, schede di controllo, circolarizzazioni e verifiche contabili. Include strumenti di confronto bilanci, analisi dei movimenti, ricavi, costi e incassi.

## Requisiti e avvio

Node.js 22, pnpm 10.4.1, MySQL 8 e `pdftotext` per le funzioni PDF. Nextcloud e servizio AI sono integrazioni da configurare per le funzioni che li usano.

1. `pnpm install --frozen-lockfile`.
2. Copiare `.env.example` in `.env`; impostare `ADMIN_PASSWORD`, `JWT_SECRET` casuale di almeno 32 caratteri e connessione a un **database nuovo di sviluppo**.
3. Esaminare `drizzle/` e gli script `scripts/ensure-*.mjs`: includono migrazioni manuali. La baseline e gli aggiornamenti devono essere valutati insieme; non eseguire migrazioni su database reali per provare questa versione.
4. Eseguire `pnpm check`, `pnpm test`, `pnpm build`.
5. Avviare con `pnpm dev` su Linux/macOS; su PowerShell impostare `$env:NODE_ENV = 'development'` e usare `pnpm exec tsx watch server/_core/index.ts`.

L'autenticazione imposta cookie Secure: usare HTTPS per provare l'intero accesso. Per la build usare `pnpm start`, oppure `node dist/index.js` dopo avere impostato NODE_ENV su PowerShell.

## Stato e limiti

**0.2.0-preview — codice per consultazione e sviluppo, non release stabile.** La prima acquisizione ha prodotto una build, ma presentava errori TypeScript e test non superati; gli esiti aggiornati sono in `../../VERIFICHE.md`. Non è stata collaudata una nuova installazione completa di database, autenticazione, Nextcloud e AI.

I risultati supportano il lavoro del revisore e non sostituiscono il suo giudizio. L'esportazione non contiene documenti, clienti o database. Il progetto include strumenti di debug dello sviluppo: usarlo solo in un ambiente isolato e valutarli prima di esporre un server. Le funzioni AI possono trasmettere contenuti al provider configurato.

## Licenze

Codice originale AGPL-3.0-only; copie precedenti e componenti di terzi mantengono i relativi diritti. Vedere `LICENSE`, `LICENSING.md` e `THIRD-PARTY.md`. Le dipendenze non sono incluse nell'archivio e vengono installate dal lockfile.
