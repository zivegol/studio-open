'use strict';
const fs = require('node:fs');
// Legge NOME_FILE (Docker secret) oppure NOME dall'ambiente
const sec = (n, d = '') => (process.env[n + '_FILE'] ? fs.readFileSync(process.env[n + '_FILE'], 'utf8').trim() : (process.env[n] ?? d));
const num = (n, d) => Number(process.env[n] ?? d);
module.exports = {
  role: process.env.ROLE || 'api',
  mode: process.env.DOWNLOADER_MODE || 'mock',          // mock | reale
  port: num('PORT', 8080),
  gruppi: (process.env.ALLOWED_GROUPS || 'admin').split(','),
  nc: { url: process.env.NC_URL || 'http://nextcloud', user: process.env.NC_USER || '',
        pass: sec('NC_APP_PASSWORD'), baseDir: process.env.NC_BASE_DIR || 'Clienti-AdE' },
  worker: { pollMs: num('POLL_MS', 5000), pausaMin: num('PAUSA_MIN_MS', 20000),
            pausaMax: num('PAUSA_MAX_MS', 90000), maxTentativi: num('MAX_TENTATIVI', 3) },
};
