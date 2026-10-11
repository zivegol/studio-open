'use strict';
// Archiviazione su Nextcloud via WebDAV con password per app dedicata (mai la password dell'utente).
const cfg = require('./config');
const auth = () => 'Basic ' + Buffer.from(`${cfg.nc.user}:${cfg.nc.pass}`).toString('base64');
const root = () => `${cfg.nc.url}/remote.php/dav/files/${encodeURIComponent(cfg.nc.user)}`;
const enc = segs => segs.map(encodeURIComponent).join('/');

async function creaCartelle(segs) {
  for (let i = 1; i <= segs.length; i++) {
    const r = await fetch(`${root()}/${enc(segs.slice(0, i))}`, { method: 'MKCOL', signal: AbortSignal.timeout(30000), headers: { Authorization: auth() } });
    if (![201, 405].includes(r.status)) throw new Error(`Nextcloud MKCOL HTTP ${r.status}`);   // 405 = esiste già
  }
}

async function carica(percorsoRelativo, buffer) {
  const segs = [...cfg.nc.baseDir.split('/'), ...percorsoRelativo.split('/')].filter(Boolean);
  await creaCartelle(segs.slice(0, -1));
  const r = await fetch(`${root()}/${enc(segs)}`, { method: 'PUT', signal: AbortSignal.timeout(60000), headers: { Authorization: auth() }, body: buffer });
  if (![200, 201, 204].includes(r.status)) throw new Error(`Nextcloud PUT HTTP ${r.status}`);
  return '/' + segs.join('/');
}
module.exports = { carica };
