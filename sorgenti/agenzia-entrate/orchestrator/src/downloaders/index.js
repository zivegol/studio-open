'use strict';
const cfg = require('../config');
class AuthRequired extends Error {}        // da lanciare quando serve l'accesso con autenticazione forte di una persona

// Contratto di ogni downloader:
//   segreti: string[]            nomi dei segreti Vault necessari (secret/studio/ade/<nome>)
//   scarica({cliente, tipo, anno, canale, segreti}) -> { buffer: Buffer, estensione: 'pdf' }
function getDownloader(canale) {
  if (cfg.mode === 'mock') return require('./mock');
  if (canale === 'api_ufficiale') return require('./api_ufficiale');
  if (canale === 'browser_automation') return require('./browser');
  throw new Error('Canale non supportato: ' + canale);
}
module.exports = { getDownloader, AuthRequired };
