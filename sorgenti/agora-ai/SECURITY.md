# Sicurezza di Agorà AI

## Confini e minacce principali

Agorà è un servizio separato da Nextcloud. Database, bucket e segreti non devono essere condivisi con Nextcloud. Le minacce prioritarie sono accesso orizzontale tra utenti, furto delle chiavi AI, allegati malevoli, callback OIDC falsificate, divulgazione di prompt nei log e superamento delle soglie di spesa.

Ogni operazione applicativa deduce l'utente dalla sessione HttpOnly; gli identificativi utente provenienti dal browser non sono accettati. Sessioni, run, voti, costi, credenziali e allegati sono filtrati per `user_id`. Gli oggetti hanno prefisso `users/<id>/attachments/<uuid>/` e il download viene firmato solo dopo il controllo di proprietà.

## Identità e sessioni

OIDC usa Authorization Code con PKCE, `state` e `nonce` monouso. ID token e JWKS sono verificati per firma, `iss`, `aud`, `exp` e `nonce`. L'identità stabile è `(issuer, subject)`. In produzione `OIDC_ALLOWED_SUBJECTS` è obbligatoria e fail-closed. I cookie sono HttpOnly, Secure, SameSite=Lax e host-only. La sessione dura 12 ore.

## Segreti

- `AGORA_ENCRYPTION_KEY` è una chiave Base64 di 32 byte distinta da `SESSION_SECRET`.
- Chiavi API, segreti OIDC/S3 e password DB esistono solo nel secret store o `.env` protetto sul server.
- `.env`, dump, certificati e chiavi private non entrano in Git o negli artifact.
- La rotazione di `AGORA_ENCRYPTION_KEY` richiede una procedura one-shot controllata; non esportare plaintext.
- Le credenziali Manus/OpenRouter dell'ambiente precedente devono essere reinserite dal titolare.

## Documenti

Sono ammessi PDF, DOCX, TXT e XLSX, massimo 5 file e 10 MB ciascuno. Per ogni file l'utente dichiara origine e stato di anonimizzazione e conferma l'invio degli estratti ai provider. Tale dichiarazione non garantisce che il documento sia realmente anonimo. Il bucket resta privato e gli URL firmati scadono dopo cinque minuti.

## Logging e disclosure

Non registrare header `Authorization`, cookie, token OIDC, chiavi API, prompt, risposte o contenuti documentali. Gli errori restituiti al client devono essere generici. Segnalazioni di sicurezza: contattare privatamente il titolare dello Studio, indicando versione, impatto e riproduzione senza allegare dati reali. Non pubblicare il difetto prima della correzione.
