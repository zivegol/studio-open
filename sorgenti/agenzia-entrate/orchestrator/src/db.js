'use strict';
const { Pool } = require('pg');           // legge PGHOST, PGDATABASE, PGUSER, PGPASSWORD
const password = process.env.PGPASSWORD_FILE ? require('node:fs').readFileSync(process.env.PGPASSWORD_FILE, 'utf8').trim() : undefined;
const pool = new Pool({ max: 5, password });

const VIETATE = /pin|pass|token|cookie|secret|p12|certificat|credenz/i;
const pulisci = o => (o && typeof o === 'object')
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, VIETATE.test(k) ? '[omesso]' : pulisci(v)])) : o;

// Il registro non deve mai contenere segreti: le chiavi sospette vengono omesse.
const audit = (c, attore, azione, clienteId, oggetto, dettagli = {}) => c.query(
  'INSERT INTO audit_log(attore,azione,cliente_id,oggetto_tipo,oggetto_id,dettagli) VALUES($1,$2,$3,$4,$5,$6)',
  [attore, azione, clienteId ?? null, oggetto?.[0] ?? null, oggetto?.[1] != null ? String(oggetto[1]) : null, JSON.stringify(pulisci(dettagli))]);

module.exports = { pool, audit };
