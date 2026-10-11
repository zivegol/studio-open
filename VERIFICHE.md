# Verifiche della distribuzione 0.2.0-preview

Data: 11 ottobre 2026. Esportazione per consultazione e sviluppo; nessuna modifica alle installazioni operative.

| Progetto | Controlli sui sorgenti ufficiali | Esito / limite |
|---|---|---|
| Agorà AI | TypeScript, Vitest e build Vite/esbuild | TypeScript superato; 57 test superati su 57; build frontend/backend riuscita. Nessun collaudo completo di una nuova istanza OIDC/S3/AI |
| Revisore Nano | TypeScript e Vitest | 9 errori TypeScript; 95 test superati e 3 falliti su 98. Versione non stabile |
| Locazioni | Modello rate e compilatore, dati sintetici e WebDAV simulato | 9 test superati. Nessuna validazione giuridica dei contratti né nuova installazione Nextcloud |
| Agenzia Entrate | Test sintetici del driver | 7 superati e 1 fallito su 8: validazione dei parametri quietanza meno restrittiva dell'aspettativa del test. Mock incompleto nei percorsi diagnostici; nessun accesso al portale reale |
| Calcolatrice / Forza 4 | Controlli della versione 0.1.0 | Test calcolatrice e prove browser su operazione, errore, navigazione, mossa/CPU/annullamento superati; programmi invariati |
| Altri moduli | Esportazione selettiva e revisione dei riferimenti incorporati | Non eseguito il collaudo funzionale completo di ogni modulo, formula o integrazione |

## Problemi noti di Revisore Nano

TypeScript: campi assenti nei tipi dei clienti (`years`, `identitySource`, `totalFiles`); iterazioni con target incompatibile e data nullable in circolarizzazione; inferenze `never` e campo `utilizzato` in verifica incassi. Due test di abbinamento rate attendono una data diversa; un test del parser Excel attende due movimenti e ne riceve uno. Non distribuire questa versione come stabile.

## Controlli dell'esportazione

Elenco esplicito dei file, nessuna cronologia Git privata o file non versionato. Esclusi database, allegati, log, credenziali, `.env` reali, test/stub dello studio e script operativi specifici. Conservati esempi e test sintetici dei progetti Node.

Sostituiti riferimenti a domini, nominativi, contatti, identificativi fiscali e indirizzi dello studio. Le segnalazioni residue sulle credenziali sono fixture sintetiche o concatenazioni di variabili. Questa revisione non è un audit di sicurezza completo; le dipendenze non sono state sottoposte a un audit completo delle vulnerabilità.

Controllo sintattico di 93 script JavaScript (file e script HTML incorporati) nella copia esportata: nessun errore di parsing. Questo controllo non esegue le applicazioni e non valida il comportamento dei backend PHP/Python.

La cartella cessioni non include il dataset territoriale ANPR: serve un dataset separato con licenza e provenienza verificate. Reguso e NC Scuola sono esclusi.
