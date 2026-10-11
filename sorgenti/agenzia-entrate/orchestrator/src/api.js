'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const cfg = require('./config');
const { pool, audit } = require('./db');

const UUID = /^[0-9a-f-]{36}$/i, DATA = /^\d{4}-\d{2}-\d{2}$/;
const send = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const leggi = req => new Promise((ok, ko) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) { ko(new Error('troppo grande')); req.destroy(); } }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { ko(e); } }); });

// L'identità arriva dalla sessione Nextcloud (cookie inoltrato dal reverse proxy): nessuna password nostra.
const cache = new Map();
async function utente(req) {
  const ck = req.headers.cookie; if (!ck) return null;
  const k = crypto.createHash('sha256').update(ck).digest('hex'), c = cache.get(k);
  if (c && c.exp > Date.now()) return c.u;
  const r = await fetch(`${cfg.nc.url}/ocs/v2.php/cloud/user?format=json`, { headers: { Cookie: ck, 'OCS-APIRequest': 'true' } });
  if (!r.ok) return null;
  const d = (await r.json()).ocs.data, u = { id: d.id, gruppi: d.groups || [] };
  if (!u.gruppi.some(g => cfg.gruppi.includes(g))) return null;
  if (cache.size > 200) cache.clear();
  cache.set(k, { u, exp: Date.now() + 60000 });
  return u;
}

const R = [];
const route = (m, p, h) => R.push([m, new RegExp('^' + p + '$'), h]);
const ID = '([0-9a-f-]{36})';

route('GET', '/api/clienti', async () => [200, (await pool.query(`
  SELECT c.id, c.denominazione, c.codice_fiscale, c.incarico_attivo,
         coalesce(json_agg(json_build_object('id',d.id,'tipo',d.tipo,'data_scadenza',d.data_scadenza,'revocata_il',d.revocata_il))
                  FILTER (WHERE d.id IS NOT NULL),'[]') AS deleghe
  FROM clienti c LEFT JOIN deleghe d ON d.cliente_id=c.id GROUP BY c.id ORDER BY c.denominazione`)).rows]);

route('POST', `/api/deleghe/${ID}/revoca`, async ({ u, p }) => {
  const r = await pool.query('UPDATE deleghe SET revocata_il=current_date WHERE id=$1 RETURNING cliente_id,tipo', [p[0]]);
  if (!r.rowCount) return [404, { errore: 'delega non trovata' }];
  await audit(pool, u.id, 'delega.revocata', r.rows[0].cliente_id, ['delega', p[0]], { tipo: r.rows[0].tipo });
  return [200, { ok: true }];
});

route('POST', `/api/deleghe/${ID}/rinnova`, async ({ u, p, body }) => {
  if (!DATA.test(body.data_scadenza || '')) return [400, { errore: 'data_scadenza non valida (AAAA-MM-GG)' }];
  const r = await pool.query('UPDATE deleghe SET revocata_il=NULL, data_scadenza=$2 WHERE id=$1 RETURNING cliente_id,tipo', [p[0], body.data_scadenza]);
  if (!r.rowCount) return [404, { errore: 'delega non trovata' }];
  await audit(pool, u.id, 'delega.rinnovata', r.rows[0].cliente_id, ['delega', p[0]], { tipo: r.rows[0].tipo, fino_al: body.data_scadenza });
  return [200, { ok: true }];
});

route('GET', '/api/job', async () => [200, (await pool.query(`
  SELECT j.id,j.cliente_id,c.denominazione,j.tipo_documento,j.anno_riferimento,j.canale,j.stato,j.tentativi,j.ultimo_errore,j.creato_il
  FROM job j JOIN clienti c ON c.id=j.cliente_id ORDER BY j.creato_il DESC LIMIT 200`)).rows]);

route('POST', '/api/job', async ({ u, body }) => {
  const a = Number(body.anno);
  if (!UUID.test(body.cliente_id || '') || !Number.isInteger(a) || a < 2000 || a > new Date().getFullYear()) return [400, { errore: 'dati non validi' }];
  const t = await pool.query('SELECT canale_preferito FROM tipi_documento WHERE codice=$1 AND attivo', [body.tipo_documento]);
  if (!t.rowCount) return [400, { errore: 'tipo documento non previsto dal catalogo' }];
  const r = await pool.query(
    'INSERT INTO job(cliente_id,tipo_documento,anno_riferimento,canale,richiesto_da) VALUES($1,$2,$3,$4,$5) RETURNING id,stato',
    [body.cliente_id, body.tipo_documento, a, t.rows[0].canale_preferito, u.id]);
  if (r.rows[0].stato === 'in_coda') await audit(pool, u.id, 'job.creato', body.cliente_id, ['job', r.rows[0].id], { tipo: body.tipo_documento, anno: a });
  return [201, r.rows[0]];   // se la delega non è valida lo stato è già bloccato_delega (il trigger lo registra)
});

route('POST', `/api/job/${ID}/resume`, async ({ u, p }) => {
  const r = await pool.query("UPDATE job SET stato='in_coda' WHERE id=$1 AND stato='attesa_autenticazione' RETURNING cliente_id", [p[0]]);
  if (!r.rowCount) return [409, { errore: 'il job non è in attesa di accesso' }];
  await audit(pool, u.id, 'job.accesso_confermato', r.rows[0].cliente_id, ['job', p[0]]);
  return [200, { ok: true }];
});

route('GET', '/api/documenti', async () => [200, (await pool.query(`
  SELECT d.id,c.denominazione,d.tipo_documento,d.anno_riferimento,d.percorso_nextcloud,d.scaricato_il,d.scadenza_conservazione,
         (d.scadenza_conservazione < current_date) AS da_rivedere
  FROM documenti d JOIN clienti c ON c.id=d.cliente_id ORDER BY d.scaricato_il DESC LIMIT 500`)).rows]);

route('GET', '/api/audit', async ({ q }) => {
  const n = Math.min(Math.max(parseInt(q.get('limit') || '100', 10) || 100, 1), 500);
  return [200, (await pool.query('SELECT id,ts,attore,azione,cliente_id,oggetto_tipo,oggetto_id,dettagli,encode(hash,\'hex\') AS hash FROM audit_log ORDER BY id DESC LIMIT $1', [n])).rows];
});
route('GET', '/api/audit/verifica', async () => {
  const r = await pool.query('SELECT id_corrotto FROM audit_verifica_catena()');
  return [200, { integra: r.rowCount === 0, righe_corrotte: r.rows.map(x => x.id_corrotto) }];
});

function start() {
  http.createServer(async (req, res) => {
    try {
      const u = await utente(req);
      if (!u) return send(res, 401, { errore: 'accesso non autorizzato' });
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'XMLHttpRequest') return send(res, 403, { errore: 'richiesta non valida' });   // difesa CSRF
      const url = new URL(req.url, 'http://x');
      for (const [m, re, h] of R) {
        const p = m === req.method && re.exec(url.pathname);
        if (!p) continue;
        const [code, out] = await h({ u, p: p.slice(1), q: url.searchParams, body: m === 'POST' ? await leggi(req) : {} });
        return send(res, code, out);
      }
      send(res, 404, { errore: 'non trovato' });
    } catch (e) { console.error('api', e.message); send(res, 500, { errore: 'errore interno' }); }
  }).listen(cfg.port, '0.0.0.0', () => console.log('api in ascolto su ' + cfg.port));
}
module.exports = { start };
