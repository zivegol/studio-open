'use strict';
// PUNTO DI INNESTO: qui va il client dei canali ufficiali (es. REST ModI per la CU),
// riusando il codice già esistente dello studio. Non contiene logica di rete.
module.exports = {
  segreti: ['modi'],     // es. secret/studio/ade/modi
  async scarica(/* { cliente, tipo, anno, segreti } */) {
    throw new Error('Non implementato: collegare il client ufficiale e restituire { buffer, estensione }');
  },
};
