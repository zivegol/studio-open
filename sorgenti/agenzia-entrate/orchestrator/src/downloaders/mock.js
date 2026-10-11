'use strict';
// Downloader di prova: nessun contatto con l'Agenzia delle Entrate. Serve a collaudare
// coda, controllo delega, archiviazione su Nextcloud, audit e attesa dell'accesso umano.
const { AuthRequired } = require('./index');
let sessioneAperta = false;
module.exports = {
  segreti: [],
  async scarica({ cliente, tipo, anno, canale }) {
    if (canale === 'browser_automation' && !sessioneAperta) {
      sessioneAperta = true;                                  // alla prossima esecuzione l'"accesso" risulta fatto
      throw new AuthRequired('Serve l\'accesso con autenticazione forte');
    }
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
    const testo = `DOCUMENTO DI PROVA\n${cliente.denominazione}\n${tipo.codice} ${anno}\n`;
    return { buffer: Buffer.from(testo), estensione: 'txt' };
  },
};
