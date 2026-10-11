'use strict';
const crypto = require('node:crypto');
const cfg = require('./config');
const { pool, audit } = require('./db');
const { conSegreti } = require('./secrets');
const nc = require('./nextcloud');
const { getDownloader, AuthRequired } = require('./downloaders');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const slug = s => s.normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
let fermo = false;

async function esegui(j) {
  if(j.documento_remoto_id){
    const existing=await pool.query('SELECT 1 FROM documenti WHERE documento_remoto_id=$1',[j.documento_remoto_id]);
    if(existing.rowCount){
      await pool.query("UPDATE job SET stato='completato', terminato_il=now() WHERE id=$1",[j.id]);
      await audit(pool,'worker','documento.gia_archiviato',j.cliente_id,['job',j.id],{});
      return;
    }
  }
  const { rows: [c] } = await pool.query('SELECT * FROM clienti WHERE id=$1', [j.cliente_id]);
  const { rows: [t] } = await pool.query('SELECT * FROM tipi_documento WHERE codice=$1', [j.tipo_documento]);
  await audit(pool, 'worker', 'job.avviato', c.id, ['job', j.id], { tipo: t.codice, canale: j.canale });

  const dl = getDownloader(j.canale);
  const remote=j.documento_remoto_id?(await pool.query('SELECT * FROM documenti_remoti WHERE id=$1',[j.documento_remoto_id])).rows[0]:null;
  const ctx = (segreti) => dl.scarica({ cliente: c, tipo: t, anno: j.anno_riferimento, documento:remote, canale: j.canale, segreti });
  const file = await (dl.segreti.length ? conSegreti(dl.segreti, ctx) : ctx({}));

  const sha = crypto.createHash('sha256').update(file.buffer).digest();
  const dup = await pool.query(
    'SELECT 1 FROM documenti WHERE cliente_id=$1 AND tipo_documento=$2 AND anno_riferimento IS NOT DISTINCT FROM $3 AND sha256=$4',
    [c.id, t.codice, j.anno_riferimento, sha]);
  if (dup.rowCount) {
    await audit(pool, 'worker', 'documento.duplicato', c.id, ['job', j.id], { esito: 'già presente, non riscaricato' });
  } else {
    const rel = `${c.codice_fiscale}_${slug(c.denominazione)}/${j.anno_riferimento ?? 'senza_anno'}/${t.codice}_${j.anno_riferimento ?? ''}_${sha.toString('hex').slice(0, 8)}.${file.estensione}`;
    const percorso = await nc.carica(rel, file.buffer);
    await pool.query(
      'INSERT INTO documenti(job_id,cliente_id,tipo_documento,anno_riferimento,sha256,percorso_nextcloud,dimensione_byte,documento_remoto_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [j.id, c.id, t.codice, j.anno_riferimento, sha, percorso, file.buffer.length,j.documento_remoto_id]);
    await audit(pool, 'worker', 'documento.scaricato', c.id, ['job', j.id], { sha256: sha.toString('hex').slice(0, 16) });
  }
  await pool.query("UPDATE job SET stato='completato', terminato_il=now(), ultimo_errore=NULL WHERE id=$1", [j.id]);
  await audit(pool, 'worker', 'job.completato', c.id, ['job', j.id]);
}

async function gestisciErrore(j, e) {
  if (e instanceof AuthRequired) {
    await pool.query("UPDATE job SET stato='attesa_autenticazione', tentativi=GREATEST(tentativi-1,0) WHERE id=$1", [j.id]);
    return audit(pool, 'worker', 'job.attesa_autenticazione', j.cliente_id, ['job', j.id]);
  }
  const msg = 'Operazione non completata: consultare lo stato del servizio senza ripetere invii incerti';            // mai dati sensibili nei messaggi
  const finale = true; // No automatic retry of remote actions without reconciliation.
  await pool.query(
    `UPDATE job SET stato=$2::stato_job, ultimo_errore=$3, terminato_il=CASE WHEN $4::boolean THEN now() END,
            pianificato_per=now()+make_interval(mins=>$5::int) WHERE id=$1`,
    [j.id, finale ? 'da_verificare' : 'in_coda', msg, finale, 5 * j.tentativi]);
  await audit(pool, 'worker', finale ? 'job.fallito' : 'job.errore_riprovo', j.cliente_id, ['job', j.id], { errore: msg, tentativo: j.tentativi });
}

async function ciclo() {
  const { rows: [w] } = await pool.query("SELECT count(*)::int AS n FROM job WHERE stato='attesa_autenticazione'");
  if (w.n) return false;                                       // si aspetta la persona prima di procedere
  const { rows: [j] } = await pool.query('SELECT * FROM prossimo_job()');
  if (!j || !j.id) return false;
  if (j.stato !== 'in_esecuzione') return true;                // il trigger l'ha bloccato per delega non valida
  try { await esegui(j); } catch (e) { await gestisciErrore(j, e); }
  return true;
}

async function start() {
  // Dopo un crash restano job "in_esecuzione": si rimettono in coda.
  await pool.query("UPDATE job SET stato='da_verificare', ultimo_errore='Esecuzione interrotta: verificare esito remoto prima di ripetere' WHERE stato='in_esecuzione'");
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { fermo = true; });
  console.log(`worker avviato (modalità ${cfg.mode})`);
  while (!fermo) {
    try {
      const lavorato = await ciclo();
      await sleep(lavorato ? rnd(cfg.worker.pausaMin, cfg.worker.pausaMax) : cfg.worker.pollMs);   // pausa "umana" tra i job
    } catch (e) { console.error('ciclo', e.message); await sleep(cfg.worker.pollMs); }
  }
  await pool.end();
}
module.exports = { start };
