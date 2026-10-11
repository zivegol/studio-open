import test from 'node:test';
import assert from 'node:assert/strict';
import {assertContext,validateQuietanzaUrl,validateTaxCode,PortalDriver,assertInvoiceSummary,assertInvoiceContext} from './portal-driver.mjs';
const studio='11111111111',client='22222222222';
const text=`Utenza di lavoro: STUDIO SINTETICO ${studio} - 000 (TEST) Cambia utenza sei nel cassetto delegato di: ${client} - CLIENTE SINTETICO`;
test('fatture: riepilogo deve confermare studio, cliente e ruolo delegato',()=>{
  const summary=`Delegato per singolo soggetto Codice fiscale del soggetto che ti ha incaricato: ${studio} Codice fiscale: ${client} Partita IVA: ${client}`;
  assert.doesNotThrow(()=>assertInvoiceSummary(summary,studio,client));
  assert.throws(()=>assertInvoiceSummary(summary,client,studio));
  assert.throws(()=>assertInvoiceSummary(summary.replace('Delegato per singolo soggetto','Incaricato'),studio,client));
});
test('fatture dello studio non possono essere attribuite al cliente',()=>{
  const home=`stai operando su: Partita IVA ${client} di CLIENTE SINTETICO ( ${client} ) in qualità di DELEGATO`;
  assert.doesNotThrow(()=>assertInvoiceContext(home,client,{home:true}));
  assert.throws(()=>assertInvoiceContext(home.replaceAll(client,studio)+' '+client,client,{home:true}));
  assert.throws(()=>assertInvoiceContext(home.replace('DELEGATO','INCARICATO'),client,{home:true}));
  assert.doesNotThrow(()=>assertInvoiceContext('Per conto di : '+client,client));
  assert.throws(()=>assertInvoiceContext('Per conto di : '+studio+' Dettaglio cliente '+client,client));
});
test('contesto corretto ammesso',()=>assert.doesNotThrow(()=>assertContext(text,studio,client)));
test('cliente differente respinto anche quando CF compare altrove',()=>assert.throws(()=>assertContext(text+' '+client,studio,'33333333333')));
test('utenza differente e sessione scaduta respinte',()=>{assert.throws(()=>assertContext(text,'33333333333',client));assert.throws(()=>assertContext('Accedi Entratel',studio,client));});
test('quietanze limitate a endpoint osservato',()=>{const u='https://cassetto.agenziaentrate.gov.it/cassfisc-web/CassettoFiscaleServlet?Ric=DetF24&stampa=Q';assert.equal(validateQuietanzaUrl(u),u);assert.throws(()=>validateQuietanzaUrl(u.replace('cassetto.agenziaentrate.gov.it','example.test')));assert.throws(()=>validateQuietanzaUrl(u.replace('stampa=Q','stampa=X')));});
test('codice fiscale rifiuta caratteri di controllo e parametri',()=>{assert.equal(validateTaxCode(' '+client+' '),client);assert.throws(()=>validateTaxCode(client+'&cliente=altro'));});
test('operazioni concorrenti non condividono il cambio cliente',async()=>{let release;const gate=new Promise(resolve=>release=resolve);const driver=new PortalDriver({goto:()=>gate});const first=driver.listF24({studio,client,year:2025});await assert.rejects(driver.listF24({studio,client:'33333333333',year:2025}),/già in corso/);release();await assert.rejects(first);});
