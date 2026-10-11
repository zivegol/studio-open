'use strict';
// PUNTO DI INNESTO: automazione del portale con Playwright, riusando il microservizio esistente.
// Regole: una sessione alla volta, ritmo umano, nessun parallelismo.
// Se la sessione non è autenticata: throw new AuthRequired(...) — il job passa in
// "attesa_autenticazione" finché una persona non conferma l'accesso dalla dashboard.
const { AuthRequired } = require('./index');   // eslint-disable-line no-unused-vars
module.exports = {
  segreti: ['entratel'],   // es. secret/studio/ade/entratel
  async scarica(/* { cliente, tipo, anno, segreti } */) {
    throw new Error('Non implementato: collegare il microservizio Playwright e restituire { buffer, estensione }');
  },
};
