// Accesso ai segreti da Vault per il worker (Node 18+, nessuna dipendenza esterna).
// Principi: login AppRole con file Docker secrets, token breve, lettura solo al momento
// del job, nessun segreto nei log, revoca del token a fine uso.
'use strict';
const fs = require('node:fs');

const VAULT_ADDR = process.env.VAULT_ADDR || 'https://vault:8200';
const ROLE_ID_FILE = process.env.VAULT_ROLE_ID_FILE || '/run/secrets/vault_role_id';
const SECRET_ID_FILE = process.env.VAULT_SECRET_ID_FILE || '/run/secrets/vault_secret_id';
// La CA interna va configurata con NODE_EXTRA_CA_CERTS=/percorso/ca.crt (mai NODE_TLS_REJECT_UNAUTHORIZED=0)

async function vault(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${VAULT_ADDR}/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Vault-Token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // Messaggio volutamente generico: non riportare mai il corpo della risposta nei log
    throw new Error(`Vault ${method} ${path} -> HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

async function login() {
  const role_id = fs.readFileSync(ROLE_ID_FILE, 'utf8').trim();
  const secret_id = fs.readFileSync(SECRET_ID_FILE, 'utf8').trim();
  const r = await vault('auth/approle/login', { method: 'POST', body: { role_id, secret_id } });
  return r.auth.client_token;
}

/**
 * Esegue fn con i segreti richiesti e li rilascia subito dopo.
 * @param {string[]} nomi  es. ['entratel', 'certificato'] -> secret/studio/ade/<nome>
 * @param {(segreti: Record<string, Record<string,string>>) => Promise<any>} fn
 */
async function conSegreti(nomi, fn) {
  if(process.env.SECRETS_PROVIDER==='docker'){
    const values={};
    try{
      for(const name of nomi){
        if(!['modi','entratel','certificato'].includes(name))throw Error('Nome segreto non consentito');
        values[name]=JSON.parse(fs.readFileSync('/run/secrets/ade_'+name,'utf8'));
      }
      return await fn(values);
    }finally{for(const value of Object.values(values))for(const key of Object.keys(value))value[key]=undefined;}
  }
  const token = await login();
  let segreti = {};
  try {
    for (const n of nomi) {
      const r = await vault(`secret/data/studio/ade/${encodeURIComponent(n)}`, { token });
      segreti[n] = r.data.data;
    }
    return await fn(segreti);
  } finally {
    // Rimozione dei riferimenti (in JS non si puo' garantire l'azzeramento della memoria:
    // per questo i segreti restano in vita solo per la durata del job).
    for (const n of Object.keys(segreti)) {
      for (const k of Object.keys(segreti[n])) segreti[n][k] = undefined;
    }
    segreti = null;
    try { await vault('auth/token/revoke-self', { method: 'POST', token }); } catch { /* token a scadenza breve */ }
  }
}

module.exports = { conSegreti };

// Esempio d'uso nel worker:
//   const { conSegreti } = require('./secrets');
//   await conSegreti(['entratel'], async ({ entratel }) => {
//     await eseguiJob(job, { pin: entratel.pin });   // il PIN non viene mai loggato
//   });
