# Checklist di accettazione

- [ ] OIDC crea/mappa lo stesso utente con `issuer + sub`; state/nonce/codice alterati falliscono chiusi.
- [ ] Il `sub` non presente in allowlist riceve 403; nessuna auto-registrazione pubblica.
- [ ] Utente B riceve 403/404 usando ID di sessioni, run, allegati o credenziali di A.
- [ ] Solo A ottiene un URL firmato di cinque minuti per il proprio allegato.
- [ ] Soltanto gli allegati selezionati sono inclusi nel prompt.
- [ ] Origine, stato di anonimizzazione e consenso sono registrati per ogni file.
- [ ] Un file non anonimizzato richiede conferma esplicita.
- [ ] La soglia hard blocca lato server prima di chiamare un provider.
- [ ] Chiavi e contenuti non compaiono in API, HTML, console, log o errori.
- [ ] Restore staging recupera sessioni e metadati; un oggetto campione coincide per checksum.
- [ ] PWA si installa su iPhone e Android usando il dominio HTTPS.
- [ ] I senior restano esattamente ChatGPT, Claude, Gemini, Kimi, Manus e Perplexity.
- [ ] La modalità Economico conserva tre junior, dossier, escalation, repair e stati parziali.
- [ ] Revoca di un `sub` dall'allowlist impedisce il login successivo.
