'use strict';
let S,tab='overview',busy=false,submitAction=null;
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur=c=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',useGrouping:'always'}).format(c/100);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dt=d=>d?d.split('-').reverse().join('/'):'—',values=o=>Object.values(o||{}),paid=n=>(n.payments||[]).reduce((a,p)=>a+p.amount,0),residual=n=>n.cancelled?0:n.totals.net-paid(n);
const invoiced=n=>(n.invoiceIds||(n.invoiceId?[n.invoiceId]:[])).map(id=>S?.invoices?.[id]).filter(Boolean).reduce((a,f)=>a+f.totals.net,0);
const pendingToInvoice=n=>Math.max(0,paid(n)-invoiced(n));
const labels={overview:'Panoramica',clients:'Clienti e accordi',notices:'Avvisi di parcella',invoices:'Fatture elettroniche',forecast:'Previsioni di incasso',services:'Tariffario servizi',studio:'Impostazioni studio'};
const statusLabels={da_inviare:'Da inviare',inviata:'Inviata · stato manuale',consegnata:'Consegnata · stato manuale',mancata_consegna:'Mancata consegna · stato manuale',scartata:'Scartata · stato manuale'};
function message(s){$('#message').hidden=!s;$('#message').textContent=s;}
async function request(op,payload){const r=await fetch('/studio-parcelle-api?op='+encodeURIComponent(op),payload===undefined?{credentials:'same-origin'}:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Parcelle-Request':'1'},body:JSON.stringify({revision:S.revision,payload})});let data;try{data=await r.json();}catch{throw Error('Risposta non valida dal server. Verificare la sessione Nextcloud.');}if(!r.ok)throw Error(data.error||'Operazione non riuscita');return data;}
async function load(){try{const d=await request('state');S=d.state;$('#connection').textContent='Archivio Nextcloud';$('#newNotice').disabled=false;message('');render();}catch(e){$('#connection').textContent='Non connesso';message(e.message);$('#view').innerHTML='<div class="empty"><strong>Archivio non disponibile</strong>Accedi a Nextcloud e premi Aggiorna. Nessun dato viene salvato nel browser.</div>';}}
async function save(op,payload){const d=await request(op,payload);S=d.state;render();return d.result;}
function button(label,action,id='',cls=''){return `<button type="button" data-action="${action}" data-id="${esc(id)}" class="${cls}">${label}</button>`;}
function empty(title,description){return `<div class="empty"><strong>${title}</strong>${description}</div>`;}
function table(head,rows){return `<div class="tablewrap"><table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
function noticeState(n){if(n.cancelled)return 'Annullato';const p=paid(n),res=residual(n),invs=(n.invoiceIds?.length||(n.invoiceId?1:0)),pend=pendingToInvoice(n);if(res===0)return invs>0?(pend>0?'Saldato · fattura residua':'Saldato e fatturato'):'Saldato · da fatturare';if(p>0)return invs>0?(pend>0?'Incasso e fattura parziale':'Fatturato parziale'):'Incasso parziale';return n.due<today()?'Scaduto':'Da incassare';}
function noticesTable(ns){return ns.length?table(['Avviso / data','Cliente','Scadenza','Netto / residuo','Stato',''],ns.map(n=>`<tr><td><b>${esc(n.number)}</b><br><small>${dt(n.date)}${n.period?' · '+esc(n.period.label):''}</small></td><td><b>${esc(n.client.name)}</b>${n.client.email?`<br><small class="muted">✉ ${esc(n.client.email)}</small>`:'<br><small style="color:#ef4444">✉ Email mancante</small>'}</td><td><span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:700">A vista</span><br><small class="muted">${dt(n.date)}</small></td><td class="right">${eur(n.totals.net)}<br><small>${eur(residual(n))} residui</small></td><td><span class="badge ${residual(n)>0?'warn':''}">${noticeState(n)}</span>${n.sentEmail?`<br><small style="color:#059669;font-weight:600">✉ Inviata ${dt(n.sentEmail.at.slice(0,10))}</small>`:''}</td><td>${button('Apri','showNotice',n.id)}</td></tr>`)):empty('Nessun avviso','Configura un cliente e crea il primo avviso di parcella.');}
function overview(){const ns=values(S.notices).filter(n=>!n.cancelled),fs=values(S.invoices),ym=today().slice(0,7);const due=ns.reduce((a,n)=>a+residual(n),0),late=ns.filter(n=>n.due<today()).reduce((a,n)=>a+residual(n),0),receipts=ns.flatMap(n=>n.payments).filter(p=>p.date.startsWith(ym)).reduce((a,p)=>a+p.amount,0),pending=ns.filter(n=>pendingToInvoice(n)>0).length;return `<div class="cards">${[['Da incassare',eur(due)],['Di cui scaduto',eur(late)],['Incassato questo mese',eur(receipts)],['Incassi da fatturare',pending]].map(([l,v])=>`<div class="card"><small>${l}</small><strong>${v}</strong></div>`).join('')}</div><div class="panel"><div class="sectionhead"><h2>Il lavoro da seguire</h2><div class="actions">${button('✉ Spedizione massiva email','bulkNoticeEmailsModal')}${button('Genera avvisi trimestrali','quarterly','','primary')}</div></div>${noticesTable(ns.filter(n=>residual(n)>0||pendingToInvoice(n)>0).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,12))}</div><div class="grid"><div class="panel"><h2>Un unico percorso</h2><p>Accordo cliente → avviso → incasso → fattura XML.</p><p class="muted">${values(S.clients).length} clienti configurati · ${fs.length} fatture archiviate</p></div><div class="panel"><h2>Invio e ricevute</h2><p>Scarica l’XML e trasmettilo con il tuo servizio. Registra qui il riferimento e l’esito.</p><p class="muted">Il download non equivale a un invio allo SdI.</p></div></div>`;}
function clientsView(){const cs=values(S.clients);return `<div class="panel"><div class="sectionhead"><h2>Anagrafiche e compensi ricorrenti</h2><div class="actions">${button('Importa dal Dossier','import')}${button('+ Nuovo Cliente','client','','primary')}</div></div><input class="search" id="search" placeholder="Cerca cliente, codice fiscale, P.IVA o email" aria-label="Cerca clienti">${cs.length?table(['Cliente','Email per invio Avvisi','Fatturazione Elettronica (SDI / PEC)','Periodicità','Prossimo avviso','Compenso netto standard','Azioni'],cs.map(c=>`<tr data-search="${esc((c.name+' '+c.cf+' '+c.vat+' '+(c.email||'')).toLowerCase())}"><td><b>${esc(c.name)}</b><br><small class="muted">${esc(c.vat||c.cf)} ${c.dossierId?'· Dossier collegato':''}</small></td><td>${c.email?`<b style="color:#0f172a">✉ ${esc(c.email)}</b><br>${button('✏️ Modifica email','quickEditClientEmail',c.id)}`:`<span style="color:#ef4444;font-weight:700">✉ Email non impostata</span><br>${button('➕ Inserisci email','quickEditClientEmail',c.id,'warn')}`}</td><td>${esc(c.sdi?'SDI: '+c.sdi:(c.pec?'PEC: '+c.pec:'Da definire'))}</td><td>${c.months?`Ogni ${c.months} mesi`:'Occasionale'}${!c.active?' · sospeso':''}</td><td>${c.months?dt(c.nextDate):'—'}</td><td class="right">${eur(calc(c.lines,c).net)}</td><td>${button('Modifica scheda','client',c.id)}</td></tr>`)):empty('Il tuo elenco clienti','Importa dal Dossier i dati identificativi e completa le condizioni di fatturazione.')}</div>`;}
function invoicesView(){return `<div class="panel"><div class="sectionhead"><h2>Registro fatture</h2>${button('Esporta CSV','csv')}</div><p class="muted">Documenti creati dall’app. Gli esiti SdI sono annotazioni manuali; lo storico non sostituisce la conservazione a norma.</p><input id="search" class="search" placeholder="Cerca fattura o cliente" aria-label="Cerca fatture">${values(S.invoices).length?table(['Fattura','Cliente','Data','Lordo','Netto','Trasmissione',''],values(S.invoices).reverse().map(f=>`<tr data-search="${esc((f.number+' '+f.client.name).toLowerCase())}"><td>${esc(f.number)}</td><td>${esc(f.client.name)}</td><td>${dt(f.date)}</td><td class="right">${eur(f.totals.gross)}</td><td class="right">${eur(f.totals.net)}</td><td><span class="badge">${statusLabels[f.status]}</span></td><td>${button('Apri','showInvoice',f.id)}</td></tr>`)):empty('Nessuna fattura ancora','Le fatture create dagli avvisi saldati compariranno qui.')}</div>`;}
function addDays(d,n){const a=new Date(d+'T12:00:00');a.setDate(a.getDate()+Number(n));return `${a.getFullYear()}-${String(a.getMonth()+1).padStart(2,'0')}-${String(a.getDate()).padStart(2,'0')}`;}
function nextDate(d,m,anchor){const [y,mo]=d.split('-').map(Number);const x=new Date(y,mo-1+Number(m),1,12);const last=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(Math.min(anchor,last)).padStart(2,'0')}`;}
function forecastData(){const ns=values(S.notices).filter(n=>!n.cancelled&&residual(n)>0),sent=ns.filter(n=>n.sentEmail),unsent=ns.filter(n=>!n.sentEmail);return {ns,sent:sent.reduce((a,n)=>a+residual(n),0),unsent:unsent.reduce((a,n)=>a+residual(n),0),total:ns.reduce((a,n)=>a+residual(n),0)};}
function futureForecast(){
 const now=today(),months=Array.from({length:6},(_,i)=>nextDate(now,i,1).slice(0,7)),rows=Object.fromEntries(months.map(m=>[m,0]));
 for(const c of values(S.clients)){
  if(!c.active||!c.months||!c.nextDate)continue;
  let date=c.nextDate;
  for(let i=0;i<1200&&date.slice(0,7)<=months.at(-1);i++){
   const exists=values(S.notices).some(n=>!n.cancelled&&n.clientId===c.id&&(n.date===date||n.recurrenceKey===c.id+':'+date));
   if(date>=now&&!exists&&rows[date.slice(0,7)]!==undefined)rows[date.slice(0,7)]+=calc(c.lines,c).net;
   const next=nextDate(date,c.months,c.anchor||Number(date.slice(8)));if(next<=date)break;date=next;
  }
 }
 return rows;
}
function forecastChart(total){
 const rows=futureForecast(),buckets=[['A vista',total,'issued'],...Object.entries(rows).map(([m,v])=>[m.slice(5)+'/'+m.slice(0,4),v,'planned'])],max=Math.max(1,...buckets.map(b=>b[1]));
 return `<div class="panel"><h2>Avvisi emessi e previsioni future</h2><p class="forecast-legend"><span class="issued-key">■ Avvisi emessi: residuo a vista</span> <span class="planned-key">■ Previsioni: compensi da accordi ricorrenti</span></p><div class="forecast-scroll"><div class="forecast-bars">${buckets.map(([label,value,type])=>`<div class="forecast-col"><strong>${eur(value)}</strong><div class="forecast-track"><div class="forecast-bar ${type}" style="height:${value?Math.max(2,Math.round(value/max*140)):0}px"></div></div><small>${label}</small></div>`).join('')}</div></div><p class="muted">La colonna verde raccoglie tutti gli avvisi aperti, da incassare a vista. Le colonne arancioni stimano i compensi dei prossimi sei mesi secondo le date degli accordi: non sono avvisi già emessi né incassi garantiti. Gli adempimenti extra futuri non sono stimati. Le ricorrenze arretrate non vengono spostate in avanti.</p>${table(['Periodo','Avvisi emessi · a vista','Previsioni · da emettere'],[`<tr><td>A vista</td><td class="issued-cell">${eur(total)}</td><td>—</td></tr>`,...Object.entries(rows).map(([m,v])=>`<tr><td>${m}</td><td>—</td><td class="planned-cell">${eur(v)}</td></tr>`)])}</div>`;
}
function forecastView(){const {ns,sent,unsent,total}=forecastData();const byClient=values(S.clients).map(c=>{const ns=values(S.notices).filter(n=>n.clientId===c.id&&!n.cancelled),fs=values(S.invoices).filter(f=>f.clientId===c.id&&f.status!=='scartata');return {name:c.name,fees:fs.reduce((a,f)=>a+f.totals.base,0),paid:ns.reduce((a,n)=>a+paid(n),0),open:ns.reduce((a,n)=>a+residual(n),0)};});return `<div class="panel"><h2>Incassi attesi dagli avvisi emessi</h2><p class="muted">Pagamento a vista, alla ricezione dell’avviso. Gli importi non sono spostati nei mesi futuri: la data effettiva dell’incasso non è ancora nota. Le previsioni dei compensi futuri sono mostrate separatamente in arancione.</p><div class="cards">${[['Residuo complessivo',total],['Avvisi con invio email registrato',sent],['Avvisi senza invio email registrato',unsent]].map(([label,value])=>`<div class="card"><small>${label}</small><strong>${eur(value)}</strong></div>`).join('')}</div><p class="note">Gli avvisi senza invio email registrato sono mostrati separatamente: potrebbero non essere ancora stati ricevuti dal cliente.</p></div>${forecastChart(total)}<div class="panel"><h2>Dettaglio importi da incassare</h2>${noticesTable(ns)}</div><div class="panel"><h2>Statistiche cumulative per cliente</h2>${table(['Cliente','Compensi fatturati¹','Incassi registrati','Residuo avvisi'],byClient.map(c=>`<tr><td>${esc(c.name)}</td><td>${eur(c.fees)}</td><td>${eur(c.paid)}</td><td>${eur(c.open)}</td></tr>`))}<p class="muted">¹ Compensi prima di cassa, IVA e ritenuta; escluse fatture segnalate come scartate.</p></div>`;}
function getServiceRates(){if(S?.serviceRates&&S.serviceRates.length)return S.serviceRates;return [{key:'f24',kind:'f24',description:'F24 elaborati e trasmessi telematicamente',amount:10},{key:'visura',kind:'visura',description:'Richiesta visure camerali',amount:10},{key:'cciaa',kind:'cciaa',description:'Pratiche CCIAA',amount:100},{key:'ade',kind:'ade',description:'Pratiche Agenzia delle Entrate',amount:100},{key:'visto',kind:'visto',description:'Visto di conformità',amount:300}];}
function serviceKindBadge(kind){const map={f24:'<span class="badge" style="background:#e0e7ff;color:#3730a3">F24</span>',visura:'<span class="badge" style="background:#dcfce7;color:#166534">Visure</span>',cciaa:'<span class="badge" style="background:#ffedd5;color:#9a3412">CCIAA</span>',ade:'<span class="badge" style="background:#e0f2fe;color:#0369a1">Ag. Entrate</span>',visto:'<span class="badge" style="background:#f3e8ff;color:#6b21a8">Visto conformità</span>',custom:'<span class="badge">Altra voce</span>'};return map[kind]||'<span class="badge">Altro</span>';}
function serviceRowHtml(r={description:'',amount:0,kind:'custom',key:''}){return `<div class="line service-row" data-key="${esc(r.key||'')}"><label>Prestazione / Servizio<input class="service-desc" value="${esc(r.description)}" required maxlength="1000" placeholder="Es. Richiesta DURC"></label><label>Tipologia<select class="service-kind"><option value="f24" ${r.kind==='f24'?'selected':''}>F24</option><option value="visura" ${r.kind==='visura'?'selected':''}>Visure</option><option value="cciaa" ${r.kind==='cciaa'?'selected':''}>Pratiche CCIAA</option><option value="ade" ${r.kind==='ade'?'selected':''}>Pratiche Ag. Entrate</option><option value="visto" ${r.kind==='visto'?'selected':''}>Visto conformità</option><option value="custom" ${r.kind==='custom'?'selected':''}>Altra voce personalizzata</option></select></label><label>Compenso unitario €<input class="service-amount" value="${esc(r.amount)}" type="number" min="0" step="0.01" required></label><button type="button" data-action="removeServiceRow" aria-label="Elimina voce tariffario">×</button></div>`;}
function servicesView(){const rates=getServiceRates();return `<div class="panel"><div class="sectionhead"><h2>Tariffario compensi unitari (servizi e adempimenti)</h2><div class="actions">${button('Modifica tariffario','editServices','','primary')}${button('+ Aggiungi servizio','addServiceToView')}</div></div><p class="muted">Fissa i compensi standard per visure CCIAA, pratiche CCIAA, pratiche Agenzia Entrate, visti di conformità, F24 e inserisci ulteriori voci personalizzate dello studio. Questi valori vengono proposti in automatico negli avvisi di parcella e restano sempre modificabili per singolo avviso.</p><div class="cards" style="margin:1.5rem 0"><div class="card"><small>Voci tariffario attive</small><strong>${rates.length}</strong></div><div class="card"><small>Tariffa F24</small><strong>${eur(Math.round((rates.find(r=>r.kind==='f24')?.amount||10)*100))}</strong></div><div class="card"><small>Tariffa Visure</small><strong>${eur(Math.round((rates.find(r=>r.kind==='visura')?.amount||10)*100))}</strong></div><div class="card"><small>Pratiche CCIAA / AdE</small><strong>${eur(Math.round((rates.find(r=>r.kind==='cciaa')?.amount||100)*100))}</strong></div></div>${table(['Prestazione / Servizio','Tipologia','Compenso unitario standard',''],rates.map((r,i)=>`<tr><td><b>${esc(r.description)}</b></td><td>${serviceKindBadge(r.kind)}</td><td class="right"><b>${eur(Math.round(r.amount*100))}</b></td><td>${button('Modifica','editServices',String(i))}</td></tr>`))}</div>`;}
function editServices(){const rates=getServiceRates();openDialog(`<h2>Tariffario compensi unitari</h2><p class="muted">Fissa i compensi unitari per visure CCIAA, pratiche CCIAA, pratiche Agenzia Entrate, visti, F24 e inserisci liberamente ulteriori voci con il relativo compenso standard.</p><div id="serviceRows">${rates.map(serviceRowHtml).join('')}</div><div style="margin:1rem 0">${button('+ Aggiungi altra voce al tariffario','addServiceRow')}</div>`,async()=>{const rows=Array.from(document.querySelectorAll('#serviceRows .service-row'));const updatedRates=rows.map(el=>({key:el.dataset.key||'',description:el.querySelector('.service-desc').value.trim(),kind:el.querySelector('.service-kind').value,amount:Number(el.querySelector('.service-amount').value)||0})).filter(r=>r.description!=='');await save('service_rates',{rates:updatedRates});});}
function adempimentiSubtitle(){const rates=getServiceRates(),mapLabels={f24:'F24',visura:'Visure',cciaa:'Pratiche CCIAA',ade:'Pratiche Ag. Entrate',visto:'Visti'};return rates.map(r=>`${mapLabels[r.kind]||r.description} (${eur(Math.round(r.amount*100))})`).join(' · ');}
function render(){if(!S)return;$('#title').textContent=labels[tab];document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$('#view').innerHTML=tab==='overview'?overview():tab==='clients'?clientsView():tab==='notices'?`<div class="panel"><div class="sectionhead"><h2>Archivio avvisi</h2><div class="actions">${button('✉ Spedizione massiva email','bulkNoticeEmailsModal','','primary')}${button('Genera avvisi trimestrali','quarterly')}${button('Da scadenziario','recurring')}</div></div>${noticesTable(values(S.notices).reverse())}</div>`:tab==='invoices'?invoicesView():tab==='forecast'?forecastView():tab==='services'?servicesView():`<div class="panel"><h2>${esc(S.studio.name)||'Configura lo studio'}</h2><p>Completa intestazione, coordinate bancarie e valori predefiniti per i nuovi accordi.</p>${S.studio.iban?`<p class="note"><b>Coordinate bancarie:</b> IBAN ${esc(S.studio.iban)} — <em>c/c intestato Professionista da configurare</em></p>`:''}${button('Modifica impostazioni','studio')} ${button('Imposta progressivo fatture','numbering')} ${button('Tariffario servizi','goToServices')} <a href="/studio-parcelle-api?op=backup" class="button" style="text-decoration:none;display:inline-block;padding:0.4rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;color:inherit;font-size:0.875rem">Esporta JSON</a> <a href="/studio-parcelle-api?op=backup_db" class="button" style="text-decoration:none;display:inline-block;padding:0.4rem 0.8rem;border:1px solid #cbd5e1;border-radius:4px;color:inherit;font-size:0.875rem">Backup SQLite (.db)</a><p class="note">Aliquote e trattamento fiscale vanno verificati prima dell’emissione. La cassa è calcolata sui compensi e inclusa nella base IVA; la ritenuta sui soli compensi. Il bollo addebitato usa natura N1 e va attivato solo quando questo trattamento è corretto per il caso.</p></div>`;}
function input(name,label,value='',type='text',required=false){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='number'?'min="0" step="0.01"':''}></label>`;}
function select(name,label,options,value){return `<label>${label}<select name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${l}</option>`).join('')}</select></label>`;}
function partyFields(c,isClient=false){return `<div class="grid">${[['name','Denominazione',true],['vat','Partita IVA'],['cf','Codice fiscale'],['address','Indirizzo'],['zip','CAP'],['city','Comune'],['province','Provincia (sigla)'],...(!isClient?[['sdi','Codice destinatario SDI (7 caratteri)'],['pec','PEC']]:[])].map(([n,l,req])=>input(n,l,c[n],n==='email'?'email':'text',req)).join('')}</div>${isClient?deliveryFields(c):''}`;}
function deliveryFields(c){const channel=c.deliveryChannel||(c.sdi?'sdi':c.pec?'pec':'');return `<div class="formsection"><h3>Ricezione fatture elettroniche</h3>${select('deliveryChannel','Recapito scelto dal cliente',[['','Da definire'],['sdi','Codice destinatario SDI (7 caratteri)'],['pec','Indirizzo PEC']],channel)}<div class="grid">${input('sdi','Codice destinatario (7 caratteri)',c.sdi)}${input('pec','PEC per le fatture',c.pec,'email')}</div></div>`;}
function syncDelivery(){const mode=$('#form [name=deliveryChannel]');if(!mode)return;for(const k of ['sdi','pec']){const el=$('#form [name='+k+']');el.disabled=mode.value!==k;el.required=mode.value===k;el.closest('label').hidden=mode.value!==k;}}
function addressNote(a){return a?`<p class="note">${esc(a.message)}${a.source?' Fonte: '+esc(a.source.displayName)+(a.source.date?' · '+dt(a.source.date):''):''}</p>`:'';}
async function fetchDossier(id){const r=await fetch('/studio-parcelle-api?op=dossier&clientId='+encodeURIComponent(id),{credentials:'same-origin'});if(!r.ok)throw Error('Impossibile recuperare i dati del cliente');return r.json();}
function rateFields(c){return `<div class="grid">${input('vatRate','IVA %',c.vatRate??22,'number',true)}${input('fundRate','Cassa %',c.fundRate??4,'number',true)}${input('withholdingRate','Ritenuta sui compensi %',c.withholdingRate??0,'number',true)}${input('stamp','Bollo addebitato, natura N1 (€)',c.stamp??0,'number',true)}${select('nature','Natura per IVA zero',['N1','N2.1','N2.2','N3.1','N3.2','N3.3','N3.4','N3.5','N3.6','N4','N5','N6.1','N6.2','N6.3','N6.4','N6.5','N6.6','N6.7','N6.8','N6.9','N7'].map(n=>[n,n]),c.nature||'N2.2')}</div>`;}
function lineAmount(l){return Math.floor((Math.round(Number(l.amount||0)*100)*Math.round(Number(l.quantity??1)*100)+50)/100);}
function lineHtml(l={description:'',amount:'',quantity:1,basis:'item'}){const autoAttr=l.autoAdempimento?` data-auto-adempimento="${esc(l.autoAdempimento)}"`:'';return `<div class="line"${autoAttr}><label>Descrizione<input class="description" list="serviceSuggestions" value="${esc(l.description)}" required maxlength="1000"></label><label>Unità<select class="basis"><option value="item" ${l.basis!=='quarter'?'selected':''}>F24 / prestazione</option><option value="quarter" ${l.basis==='quarter'?'selected':''}>Trimestre</option></select></label><label>Quantità<input class="quantity" value="${esc(l.quantity??1)}" type="number" min="0.01" max="10000" step="0.01" required></label><label>Compenso unitario €<input class="amount" value="${esc(l.amount)}" type="number" min="0.01" step="0.01" required></label><div class="line-total">${eur(lineAmount(l))}</div><button type="button" data-action="removeLine" aria-label="Elimina riga">×</button></div>`;}
function linesFields(ls){const rateDescs=getServiceRates().map(r=>r.description),defaults=['Compenso per tenuta della contabilità ed adempimenti fiscali',...rateDescs,'Spese anticipate (esenti IVA ex art. 15 DPR 633/72)'],uniqueDescs=Array.from(new Set(defaults));return `<div class="formsection"><h3>Righe di compenso</h3><p class="muted">Indica o modifica descrizioni, quantità e prezzi unitari. Le righe “Trimestre” seguono i trimestri selezionati; per F24, visure, pratiche e visti la quantità proposta è quella effettiva dal registro adempimenti.</p><datalist id="serviceSuggestions">${uniqueDescs.map(d=>'<option value="'+esc(d)+'">').join('')}</datalist><div id="lines">${(ls?.length?ls:[{}]).map(lineHtml).join('')}</div>${button('+ Aggiungi riga / prestazione occasionale','addLine')}</div>`;}
function getForm(){const data=Object.fromEntries(new FormData($('#form')));if($('#form [name=periodQuarter]'))data.periodQuarters=Array.from(document.querySelectorAll('#form [name=periodQuarter]:checked:not(:disabled)')).map(el=>el.value);if($('#lines')||$('#form [name=accountingAmount]')){let lines=$('#lines')?Array.from(document.querySelectorAll('#lines .line')).map(el=>({description:el.querySelector('.description').value,amount:el.querySelector('.amount').value,quantity:el.querySelector('.quantity').value,basis:el.querySelector('.basis').value})):[];if($('#form [name=accountingAmount]')){const accAmount=$('#form [name=accountingAmount]').value;const accDesc=$('#form [name=accountingDescription]')?.value||'Compenso per tenuta della contabilità ed adempimenti fiscali';if(accAmount!=='')lines=[{description:accDesc,amount:accAmount,quantity:1,basis:'quarter'},...lines];}data.lines=lines;}return data;}
function calc(ls,r){const cents=v=>Math.round(Number(v||0)*100),percent=(a,p)=>Math.floor((a*cents(p)+5000)/10000),base=(ls||[]).reduce((a,l)=>a+lineAmount(l),0),fund=percent(base,r?.fundRate??4),vat=percent(base+fund,r?.vatRate??22),withholding=percent(base,r?.withholdingRate??0),stamp=cents(r?.stamp??0);return {base,fund,vat,withholding,stamp,gross:base+fund+vat+stamp,net:base+fund+vat+stamp-withholding};}
function updateTotal(){document.querySelectorAll('#lines .line').forEach(el=>{el.querySelector('.line-total').textContent=eur(lineAmount({amount:el.querySelector('.amount').value,quantity:el.querySelector('.quantity').value}));});if($('#liveTotal')){const d=getForm();$('#liveTotal').textContent='Netto a pagare: '+eur(calc(d.lines,d).net);}}
function openDialog(html,action,label='Salva'){submitAction=action;$('#formBody').innerHTML=html;$('#submit').textContent=label;$('#submit').hidden=!action;$('#closeDialog').textContent=action?'Annulla':'Chiudi';if(!$('#dialog').open)$('#dialog').showModal();syncDelivery();updateTotal();}
function clientEditor(id,imported){
    const c=id?S.clients[id]:{vatRate:S.studio.vatRate,fundRate:S.studio.fundRate,withholdingRate:S.studio.withholdingRate,stamp:0,nature:S.studio.nature,email:'', ...imported,lines:[{description:'Compenso per tenuta della contabilità ed adempimenti fiscali',amount:'',quantity:1,basis:'quarter'}],months:3,days:0,nextDate:today(),active:true};
    const accLine=c.lines?.find(l=>l.basis==='quarter'||(l.description||'').toLowerCase().includes('contabilit'))||c.lines?.[0]||{description:'Compenso per tenuta della contabilità ed adempimenti fiscali',amount:'',quantity:1,basis:'quarter'};
    const otherLines=(c.lines||[]).filter(l=>l!==accLine);

    openDialog(`<h2>${id?'Modifica scheda cliente: '+esc(c.name):'Nuovo cliente'}</h2>
        ${c.dossierId?'<p class="note">Identità recuperata dal Dossier. Completa e verifica i dati di fatturazione e contatto; i dati salvati saranno consultabili nel Dossier, nella sezione Contatti, accordi e avvisi.</p>':''}
        <div class="formsection" style="background:#f0fdf4; border:2px solid #16a34a; border-radius:10px; padding:16px; margin:12px 0 20px 0; box-shadow:0 2px 6px rgba(22,163,74,0.12);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                <h3 style="color:#166534; margin:0; font-size:16px; font-weight:700; display:flex; align-items:center; gap:8px;">
                    ✉️ Indirizzo Email Ordinaria (Spedizione Avvisi di Parcella e Solleciti)
                </h3>
                ${id ? `<button type="button" class="btn-sm" style="background:#16a34a; color:#fff; border:none; padding:6px 14px; border-radius:5px; font-size:13px; font-weight:bold; cursor:pointer;" onclick="saveClientEmailNow('${esc(id)}')">💾 Salva subito solo email</button>` : ''}
            </div>
            <p class="muted" style="margin:0 0 10px 0; font-size:12px; color:#15803d;">
                Inserisci o modifica qui l'indirizzo email del cliente per la spedizione degli avvisi di parcella in PDF e delle comunicazioni di studio.
            </p>
            <label style="font-weight:700; color:#166534; font-size:13px; display:block;">
                Email Ordinaria del Cliente:
                <input id="clientEmailInput" name="email" type="email" value="${esc(c.email||'')}" placeholder="es. amministrazione@azienda.it" style="font-size:16px; padding:10px 12px; border:2px solid #86efac; border-radius:6px; background:#fff; width:100%; margin-top:4px;" autofocus>
            </label>
        </div>
        ${partyFields(c,true)}
        ${addressNote(c.billingAddress)}
        ${c.dossierId?button('Completa indirizzo dal Dossier','refreshAddress',c.dossierId):''}
        <div class="formsection grid">
            ${select('months','Periodicità fatturazione',[[0,'Occasionale'],[1,'Mensile'],[2,'Bimestrale'],[3,'Trimestrale'],[4,'Quadrimestrale'],[6,'Semestrale'],[12,'Annuale']],c.months)}
            ${input('nextDate','Prossima data avviso',c.nextDate,'date',true)}
            <label>Termine pagamento<input value="A vista (alla ricezione dell’avviso)" readonly><input type="hidden" name="days" value="0"></label>
            <label><input type="checkbox" name="active" ${c.active?'checked':''}> Accordo attivo</label>
        </div>
        <div class="formsection">
            <h3>Compenso concordato per tenuta contabilità ed adempimenti fiscali</h3>
            <p class="muted">Indica il compenso concordato a trimestre per la tenuta della contabilità ed adempimenti fiscali. Tutte le altre voci variabili (F24, visure, pratiche, visti) vengono lette e proposte nella sezione “Avvisi di parcella” dal registro adempimenti.</p>
            <div class="grid">
                ${input('accountingDescription','Descrizione compenso concordato',accLine.description||'Compenso per tenuta della contabilità ed adempimenti fiscali','text',true)}
                ${input('accountingAmount','Importo concordato a trimestre (€)',accLine.amount,'number',true)}
            </div>
            <details class="custom-agreements" ${otherLines.length?'open':''}>
                <summary>Altre voci concordate fisse ${otherLines.length?`(${otherLines.length})`:''}</summary>
                <p class="muted">Opzionale: da compilare solo per eventuali altri accordi contrattuali fissi. Le prestazioni variabili come F24 e pratiche vanno inserite negli avvisi.</p>
                <div id="lines">${otherLines.map(lineHtml).join('')}</div>
                ${button('+ Aggiungi altra voce concordata','addLine')}
            </details>
        </div>
        <div class="formsection">${rateFields(c)}</div>
        <div class="summary" id="liveTotal"></div>`,async()=>{
            const formData=getForm();
            const lines=(formData.lines||[]).filter(l=>l.description&&l.amount);
            await save('client',{
                ...formData,
                lines,
                active:!!$('#form [name=active]').checked,
                id:id||'',
                dossierId:c.dossierId||''
            });
        });
}
function studioEditor(){
    const s=S.studio;
    openDialog(`<h2>Impostazioni dello studio</h2>
        ${partyFields(s)}
        ${input('iban','IBAN bonifici (c/c intestato Professionista da configurare)',s.iban)}
        <p class="muted">Dicitura associata all’IBAN nei documenti: <b>c/c intestato Professionista da configurare</b></p>
        <div class="formsection grid">
            ${select('regime','Regime fiscale',[['RF01','RF01 · Ordinario'],['RF19','RF19 · Forfettario']],s.regime)}
            ${select('withholdingType','Tipo ritenuta',[['RT01','RT01 · Persona fisica'],['RT02','RT02 · Persona giuridica']],s.withholdingType)}
            ${input('fundType','Codice cassa (es. TC02)',s.fundType,'text',true)}
        </div>
        <h3>Valori predefiniti per nuovi accordi</h3>
        ${rateFields(s)}
        <div class="formsection">
            <h3>Tariffario servizi e adempimenti</h3>
            <p class="muted">Configura i compensi unitari per visure CCIAA, pratiche CCIAA, pratiche Agenzia Entrate, visti e ulteriori prestazioni dello studio.</p>
            ${button('Gestisci tariffario servizi','goToServices')}
        </div>`,async()=>save('studio',getForm()));
}

let adempimentiRequestId=0;
async function loadAdempimentiForNotice(autoApply=true){
    const requestId=++adempimentiRequestId;
    const clientId=$('#form [name=clientId]')?.value;
    const year=$('#form [name=periodYear]')?.value||new Date().getFullYear();
    const qs=Array.from(document.querySelectorAll('#form [name=periodQuarter]:checked:not(:disabled)')).map(el=>el.value);
    const statusBox=$('#adempimentiStatus');
    if(!clientId||!statusBox)return;
    if(!qs.length){
        statusBox.textContent='Seleziona uno o più trimestri di riferimento per verificare gli adempimenti del periodo.';
        return;
    }
    statusBox.textContent='Verifica adempimenti in corso dal registro studio-example…';
    try {
        const r=await fetch('/studio-parcelle-api?op=adempimenti&clientId='+encodeURIComponent(clientId)+'&quarters='+encodeURIComponent(qs.join(','))+'&year='+encodeURIComponent(year),{credentials:'same-origin'});
        if(!r.ok)throw new Error('Impossibile recuperare i dati dal registro adempimenti');
        const data=await r.json();
        if(requestId!==adempimentiRequestId || !statusBox.isConnected)return;
        if(data.matched){
            statusBox.innerHTML=`<strong>${esc(data.summaryText)}</strong>`;
            if(autoApply){
                const proposedDescs=new Set((data.proposedLines||[]).map(p=>p.description.trim().toLowerCase()));
                document.querySelectorAll('#lines .line[data-auto-adempimento]').forEach(el=>{
                    const desc=el.querySelector('.description')?.value.trim().toLowerCase();
                    if(!proposedDescs.has(desc)) el.remove();
                });
                if(data.proposedLines?.length){
                    const currentLines=Array.from(document.querySelectorAll('#lines .line'));
                    for(const pl of data.proposedLines){
                        const existing=currentLines.find(el=>el.querySelector('.description').value.trim().toLowerCase()===pl.description.trim().toLowerCase());
                        if(existing){
                            existing.dataset.autoAdempimento=pl.kind;
                            existing.querySelector('.quantity').value=pl.quantity;
                            existing.querySelector('.amount').value=pl.amount;
                        } else {
                            $('#lines').insertAdjacentHTML('beforeend',lineHtml({
                                description:pl.description,
                                amount:pl.amount,
                                quantity:pl.quantity,
                                basis:'item',
                                autoAdempimento:pl.kind
                            }));
                        }
                    }
                    updateTotal();
                    statusBox.innerHTML+=`<br><span class="badge">Voci inserite nell’avviso · Puoi modificare descrizioni, quantità e importi, o aggiungere altre voci.</span>`;
                } else {
                    updateTotal();
                }
            }
        } else {
            statusBox.textContent=data.message||'Nessun adempimento trovato nel registro per questo cliente.';
        }
    } catch(e){
        if(requestId!==adempimentiRequestId || !statusBox.isConnected)return;
        statusBox.textContent='Registro adempimenti: '+e.message;
    }
}

function noticeEditor(noticeId){
    const n=noticeId?S.notices[noticeId]:null,cs=values(S.clients);
    if(!cs.length){message('Aggiungi prima un cliente o importalo dal Dossier.');tab='clients';render();return;}
    const draw=id=>{
        const c=S.clients[id],source=n&&n.clientId===id?n:null;
        const initialLines=source?.lines||c.lines;
        openDialog(`<h2>${n?'Modifica avviso '+esc(n.number):'Nuovo avviso di parcella'}</h2>
            ${select('clientId','Cliente',cs.map(c=>[c.id,esc(c.name)]),id)}
            <div class="grid">
                ${input('date','Data avviso',n?.date||today(),'date',true)}
                <div>
                    <label>Scadenza dell’avviso
                        <div style="padding:0.45rem 0.65rem;background:#f8fafc;border:1px solid #cbd5e1;border-radius:4px;font-weight:700;color:#0369a1;margin-top:0.25rem">A vista (alla ricezione dell’avviso)</div>
                    </label>
                    <input type="hidden" name="due" value="${n?.date||today()}">
                </div>
            </div>
            ${quarterFields(true)}
            <div class="adempimenti-box">
                <div class="adempimenti-head">
                    <div><strong>📋 Voci dal Registro Adempimenti</strong><br><small class="muted">${adempimentiSubtitle()}</small></div>
                    <button type="button" class="btn-sm" data-action="fetchAdempimenti">🔍 Pesca dal registro</button>
                </div>
                <div id="adempimentiStatus" class="adempimenti-status">Verifica adempimenti per i trimestri selezionati…</div>
            </div>
            ${input('serviceDescription','Descrizione generale della prestazione (facoltativa)',n?.serviceDescription||'')}
            ${linesFields(initialLines)}
            <div class="formsection">${rateFields(source?.rates||c)}</div>
            ${input('note','Note per il cliente',n?.note||'')}
            <div class="summary" id="liveTotal"></div>`,async()=>save(n?'notice_update':'notice',{...getForm(),...(n?{id:n.id}:{})}),n?'Salva modifiche':'Crea avviso');

        if(n){
            $('#form [name=periodEnabled]').checked=!!n.period;
            if(n.period){
                $('#form [name=periodYear]').value=n.period.year;
                const qs=n.period.quarters||[n.period.quarter];
                document.querySelectorAll('#form [name=periodQuarter]').forEach(el=>el.checked=qs.includes(Number(el.value)));
            }
            document.querySelectorAll('#form [name=periodYear],#form [name=periodQuarter]').forEach(el=>el.disabled=!n.period);
            loadAdempimentiForNotice(false);
        } else {
            syncQuarterQuantities();
            loadAdempimentiForNotice(true);
        }
        $('#form [name=clientId]').onchange=e=>draw(e.target.value);
        const dateInput = $('#form [name=date]');
        if(dateInput) dateInput.onchange = e => { const d = $('#form [name=due]'); if(d) d.value = e.target.value; };
    };
    draw(n?.clientId||cs[0].id);
}

function docHtml(n,isInvoice){
    const t=n.totals;
    const ibanInfo = `
    <div class="payment-box" style="margin-top:1.5rem;padding:1rem 1.25rem;background:#f8fafc;border:1px solid #cbd5e1;border-left:5px solid #0284c7;border-radius:6px;font-size:0.95rem">
        <div style="font-weight:bold;margin-bottom:0.4rem;color:#0f172a;font-size:1rem">Coordinate per il pagamento (Bonifico Bancario):</div>
        <div style="margin-bottom:0.3rem"><strong>Intestatario conto corrente (Beneficiario):</strong> <span style="font-size:1.05rem;font-weight:bold;color:#0f172a">Professionista da configurare</span></div>
        <div style="margin-bottom:0.3rem"><strong>IBAN di accredito:</strong> <code style="font-size:1.1rem;font-weight:bold;letter-spacing:1px;color:#0369a1">${esc(n.studio.iban||'IBAN non configurato')}</code></div>
        <div><strong>Scadenza del pagamento:</strong> <b style="color:#0369a1">A vista</b> (alla ricezione dell’avviso)</div>
    </div>`;

    return `<div class="document"><div class="printhead"><div><h2>${esc(n.studio.name)||'Studio da configurare'}</h2><p>${esc(n.studio.address||'')}<br>${esc(n.studio.zip||'')} ${esc(n.studio.city||'')}<br>P. IVA ${esc(n.studio.vat||'')}</p></div><div><h3>${esc(n.client.name)}</h3><p>${esc(n.client.address)}<br>${esc(n.client.zip)} ${esc(n.client.city)}<br>${esc(n.client.vat||n.client.cf)}${n.client.email?`<br>✉ ${esc(n.client.email)}`:''}</p></div></div><h2>${isInvoice?'Fattura':'Avviso di parcella'} ${esc(n.number)}</h2><p>Data ${dt(n.date)}${!isInvoice?' · <b style="color:#0369a1">Scadenza: A vista</b>':' · Rif. avviso '+esc(n.noticeNumber)}</p>${n.period?`<p class="reference-period"><b>Periodo di riferimento: ${esc(n.period.label)}</b><br>${periodDates(n.period)}</p>`:''}${n.serviceDescription?`<p><b>${esc(n.serviceDescription)}</b></p>`:''}${!isInvoice?'<p class="note">Avviso di parcella: documento non valido ai fini fiscali. La fattura elettronica verrà emessa all’incasso.</p>':'<p class="note">Copia di cortesia. Il documento elettronico è il file XML trasmesso a SdI.</p>'}${table(['Descrizione','Quantità','Compenso unitario','Totale'],n.lines.map(l=>`<tr><td>${esc(l.description)}${l.basis==='quarter'?'<br><small>Per trimestre</small>':''}</td><td class="right">${esc(l.quantity??1)}</td><td class="right">${eur(Math.round(l.amount*100))}</td><td class="right">${eur(lineAmount(l))}</td></tr>`))}<div class="summary">Compensi ${eur(t.base)} · Cassa ${eur(t.fund)} · IVA ${eur(t.vat)}<br>Bollo ${eur(t.stamp)} · Totale ${eur(t.gross)} · Ritenuta ${eur(t.withholding)}<br><strong>Netto a pagare ${eur(t.net)}</strong></div>${n.note?`<p>${esc(n.note)}</p>`:''}${!isInvoice?ibanInfo:(n.studio.iban?`<p>Bonifico · IBAN ${esc(n.studio.iban)} (c/c intestato Professionista da configurare)</p>`:'')}</div>`;
}

function showNotice(id){
    const n=S.notices[id];
    const payments=n.payments.length?table(['Incasso','Importo','Riferimento','Fattura XML',''],n.payments.map(p=>{const inv=p.invoiceId?S.invoices[p.invoiceId]:null;return `<tr><td>${dt(p.date)}</td><td class="right">${eur(p.amount)}</td><td>${esc(p.reference||'—')}</td><td>${inv?`<span class="badge">Fattura ${esc(inv.number)}</span>`:'<span class="badge warn">Da fatturare</span>'}</td><td>${inv?button('Apri fattura','showInvoice',inv.id):button('Crea fattura XML','invoice',`${n.id}:${p.id}`,'primary')}</td></tr>`;})):'';
    const canInvoiceAll=!n.cancelled&&pendingToInvoice(n)>0;
    const invCount=n.invoiceIds?.length||(n.invoiceId?1:0);
    const invoiceButtons=(n.invoiceIds||(n.invoiceId?[n.invoiceId]:[])).map(invId=>S.invoices[invId]?button('Apri fattura '+S.invoices[invId].number,'showInvoice',invId):'').join('');
    
    const emailStatus = n.sentEmail 
        ? `<div style="margin:0.5rem 0"><span class="badge" style="background:#dcfce7;color:#166534;font-size:0.875rem;padding:4px 8px">✉ Inviato via email a <b>${esc(n.sentEmail.to)}</b> il ${dt(n.sentEmail.at.slice(0,10))}</span></div>`
        : `<div style="margin:0.5rem 0"><span class="badge" style="background:#fef3c7;color:#92400e;font-size:0.875rem;padding:4px 8px">✉ Non ancora inviato via email</span></div>`;

    const emailBtnLabel = n.client.email ? `✏️ Email cliente (${esc(n.client.email)})` : '➕ Imposta email cliente';

    openDialog(`${docHtml(n,false)}<div class="noprint"><h3>${noticeState(n)} · Incassato ${eur(paid(n))} · Residuo ${eur(residual(n))}</h3>${emailStatus}${payments}<div class="actions">${button('✉ Spedisci via email','prepareSendNoticeEmail',id,'primary')}${button(emailBtnLabel,'quickEditClientEmail',n.clientId)}${button('Stampa / PDF','print')}${!n.cancelled&&!n.payments.length&&!invCount?button('Modifica avviso','editNotice',id):''}${!n.cancelled&&residual(n)>0?button('Registra incasso','payment',id,'primary'):''}${canInvoiceAll?button('Crea fattura XML incassi pendenti','invoice',id,'primary'):''}${!n.cancelled&&!n.payments.length&&!invCount?button('Annulla avviso','cancel',id,'danger'):''}${invoiceButtons}</div></div>`,null);
}

window.saveClientEmailNow = async (clientId) => {
    const inputEl = document.getElementById('clientEmailInput') || document.querySelector('#form [name=email]');
    const email = (inputEl?.value || '').trim();
    if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        alert('Inserire un indirizzo email valido');
        return;
    }
    try {
        const res = await fetch('/studio-parcelle-api?op=update_client_email', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Parcelle-Request': '1' },
            body: JSON.stringify({ payload: { clientId, email } })
        });
        if(!res.ok){
            const err = await res.json().catch(()=>({}));
            throw new Error(err.error || 'Errore salvataggio email');
        }
        const data = await res.json();
        S = data.state;
        render();
        message(`Email aggiornata con successo nella scheda del cliente!`);
        alert(`✅ Email salvata nella scheda di ${S.clients[clientId]?.name || 'cliente'}: ${email || '(vuota)'}`);
    } catch(e) {
        alert('Errore salvataggio email: ' + e.message);
    }
};

function quickEditClientEmail(id){
    const c = S.clients[id];
    if(!c) return;
    openDialog(`<h2>✉️ Imposta / Modifica Email per ${esc(c.name)}</h2>
        <p class="muted">Questo indirizzo email viene salvato nella scheda del cliente e utilizzato per la spedizione degli avvisi di parcella in PDF (invio singolo e massivo) e nelle altre app dello studio.</p>
        <div class="formsection" style="background:#f0fdf4; border:2px solid #86efac; border-radius:10px; padding:16px; margin:16px 0;">
            <label style="font-weight:700; color:#166534; font-size:14px; display:block;">
                Indirizzo Email Ordinaria del Cliente:
                <input type="email" id="quickEmailVal" value="${esc(c.email||'')}" placeholder="es. amministrazione@azienda.it" style="font-size:16px; padding:10px; width:100%; border:2px solid #86efac; border-radius:6px; margin-top:8px;" autofocus>
            </label>
            <p class="muted" style="margin:8px 0 0 0; font-size:12px;">Inserisci l'indirizzo email ordinario del cliente (non la PEC, salvo diversa indicazione).</p>
        </div>`, async()=>{
            const email = ($('#quickEmailVal')?.value||'').trim();
            if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
                alert('Inserire un indirizzo email valido (es. info@azienda.it)');
                return false;
            }
            const res = await fetch('/studio-parcelle-api?op=update_client_email', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Parcelle-Request': '1' },
                body: JSON.stringify({ payload: { clientId: id, email } })
            });
            if(!res.ok){
                const err = await res.json().catch(()=>({}));
                throw new Error(err.error||'Errore salvataggio email');
            }
            const data = await res.json();
            S = data.state;
            render();
            message(`Email salvata nella scheda di ${c.name}: ${email||'(nessuna email)'}`);
        }, 'Salva Email nella Scheda');
}

async function prepareSendNoticeEmail(id){
    const n = S.notices[id];
    openDialog(`<h2>Preparazione spedizione email · Avviso ${esc(n.number)}</h2><p>Generazione anteprima in corso…</p>`, null);
    try {
        const r = await fetch('/studio-parcelle-api?op=email_preview&noticeId='+encodeURIComponent(id), {credentials:'same-origin'});
        if(!r.ok) throw new Error('Impossibile recuperare anteprima email');
        const data = await r.json();
        const em = data.email;
        const mailtoUrl = `mailto:${encodeURIComponent(em.toEmail)}?subject=${encodeURIComponent(em.subject)}&body=${encodeURIComponent(em.text)}`;

        openDialog(`<h2>✉ Spedizione email · Avviso ${esc(n.number)}</h2>
        <p class="muted">Il testo contiene il riepilogo dell'avviso e <b>l'avvertenza specifica sul IBAN configurato per lo studio</b>.</p>
        <div class="formsection">
            <label>Indirizzo email destinatario
                <input name="toEmail" id="sendToEmail" type="email" value="${esc(em.toEmail)}" required placeholder="cliente@esempio.it">
            </label>
            <label style="display:flex;align-items:center;gap:0.5rem;margin:0.5rem 0">
                <input type="checkbox" id="sendUpdateClientEmail" checked>
                <span>Salva/aggiorna questo indirizzo email nell'anagrafica di ${esc(n.client.name)}</span>
            </label>
            <label>Oggetto dell'email
                <input name="subject" id="sendSubject" type="text" value="${esc(em.subject)}" required>
            </label>
            <label>Testo del messaggio
                <textarea name="bodyText" id="sendBodyText" rows="12" style="font-family:monospace;font-size:0.85rem;line-height:1.4;width:100%;padding:8px" required>${esc(em.text)}</textarea>
            </label>
        </div>
        <div style="margin:1rem 0;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
            <a href="${mailtoUrl}" target="_blank" class="button" style="text-decoration:none;display:inline-block;padding:0.45rem 0.85rem;border:1px solid #cbd5e1;border-radius:4px;color:inherit;font-size:0.875rem">Apri in Outlook / Mail desktop</a>
            <button type="button" class="btn-sm" id="copyEmailTextBtn">Copia testo email</button>
        </div>
        <details style="margin-top:1rem;border:1px solid #cbd5e1;border-radius:6px;padding:8px;background:#f8fafc">
            <summary style="cursor:pointer;font-weight:600;color:#0284c7">👁 Mostra anteprima grafica HTML</summary>
            <div style="margin-top:10px;max-height:260px;overflow-y:auto;background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:10px">
                ${em.html}
            </div>
        </details>`, async()=>{
            const toEmail = $('#sendToEmail').value.trim();
            if(!toEmail) throw new Error('Inserire l’indirizzo email del destinatario');
            const subject = $('#sendSubject').value.trim();
            const bodyText = $('#sendBodyText').value.trim();
            const updateClient = $('#sendUpdateClientEmail').checked;
            
            message('Invio email in corso…');
            const res = await request('send_email', {
                noticeId: id,
                toEmail,
                subject,
                bodyText,
                updateClientEmail: updateClient
            });
            S = res.state;
            render();
            message(`Avviso ${n.number} inviato via email a ${toEmail} con successo!`);
        }, 'Invia email ora');

        setTimeout(()=>{
            const copyBtn = $('#copyEmailTextBtn');
            if(copyBtn){
                copyBtn.onclick = async()=>{
                    try {
                        await navigator.clipboard.writeText($('#sendBodyText').value);
                        copyBtn.textContent = 'Copiato!';
                        setTimeout(()=>copyBtn.textContent='Copia testo email', 2000);
                    } catch {
                        $('#sendBodyText').select();
                    }
                };
            }
        }, 80);
    } catch(err) {
        message(err.message);
    }
}

function bulkNoticeEmailsModal(){
    const ns = values(S.notices).filter(n=>!n.cancelled);
    if(!ns.length){
        message('Nessun avviso disponibile per la spedizione.');
        return;
    }

    const rows = ns.map(n=>{
        const hasEmail = Boolean(n.client.email);
        const sentBadge = n.sentEmail 
            ? `<span class="badge" style="background:#dcfce7;color:#166534">Già inviato ${dt(n.sentEmail.at.slice(0,10))}</span>`
            : `<span class="badge">Da inviare</span>`;

        return `<tr data-notice-id="${esc(n.id)}">
            <td style="text-align:center"><input type="checkbox" class="bulk-check" value="${esc(n.id)}" ${hasEmail&&!n.sentEmail?'checked':''}></td>
            <td><b>${esc(n.number)}</b><br><small>${dt(n.date)}</small></td>
            <td>${esc(n.client.name)}</td>
            <td>
                <input type="email" class="bulk-email" data-notice-id="${esc(n.id)}" value="${esc(n.client.email||'')}" placeholder="Inserisci email" style="width:100%;max-width:240px;padding:4px 8px;font-size:0.875rem;${!hasEmail?'border:1px solid #ef4444;background:#fff5f5':''}">
            </td>
            <td class="right">${eur(n.totals.net)}</td>
            <td class="center">${sentBadge}</td>
        </tr>`;
    });

    openDialog(`<h2>✉ Spedizione massiva avvisi di parcella via email</h2>
    <p class="muted">Seleziona gli avvisi da spedire. Ciascun cliente riceverà la propria email con il riepilogo delle prestazioni e la <b>comunicazione obbligatoria sul IBAN configurato per lo studio</b>. Se l'indirizzo email viene inserito o modificato nella tabella, verrà automaticamente memorizzato nel profilo del cliente.</p>
    <div style="margin:0.75rem 0;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
        <button type="button" class="btn-sm" id="bulkSelectAll">Seleziona tutti</button>
        <button type="button" class="btn-sm" id="bulkSelectUnsent">Seleziona solo non ancora inviati</button>
        <button type="button" class="btn-sm" id="bulkDeselectAll">Deseleziona tutti</button>
    </div>
    <div class="tablewrap" style="max-height:360px;overflow-y:auto">
        <table>
            <thead>
                <tr>
                    <th style="width:40px;text-align:center">Invia</th>
                    <th>Avviso</th>
                    <th>Cliente</th>
                    <th>Email destinatario</th>
                    <th class="right">Netto</th>
                    <th class="center">Stato invio</th>
                </tr>
            </thead>
            <tbody>
                ${rows.join('')}
            </tbody>
        </table>
    </div>`, async()=>{
        const checkedBoxes = Array.from(document.querySelectorAll('.bulk-check:checked'));
        if(!checkedBoxes.length) throw new Error('Selezionare almeno un avviso da inviare');
        
        const items = [];
        for(const cb of checkedBoxes){
            const nid = cb.value;
            const inputEl = document.querySelector(`.bulk-email[data-notice-id="${nid}"]`);
            const email = inputEl?.value.trim() || '';
            if(!email) throw new Error(`Indirizzo email mancante per l'avviso ${S.notices[nid]?.number} (${S.notices[nid]?.client.name})`);
            items.push({noticeId: nid, toEmail: email});
        }

        message(`Spedizione di ${items.length} email in corso…`);
        const res = await request('bulk_send_emails', { items });
        S = res.state;
        render();
        let msg = `${res.sentCount} avvisi inviati via email con successo!`;
        if(res.errors && res.errors.length){
            msg += ` (${res.errors.length} errori: ${res.errors.map(e=>e.error).join(', ')})`;
        }
        message(msg);
    }, 'Spedisci email selezionate');

    setTimeout(()=>{
        $('#bulkSelectAll')?.addEventListener('click', ()=>{
            document.querySelectorAll('.bulk-check').forEach(el=>el.checked=true);
        });
        $('#bulkDeselectAll')?.addEventListener('click', ()=>{
            document.querySelectorAll('.bulk-check').forEach(el=>el.checked=false);
        });
        $('#bulkSelectUnsent')?.addEventListener('click', ()=>{
            document.querySelectorAll('tbody tr').forEach(row=>{
                const nid = row.dataset.noticeId;
                const n = S.notices[nid];
                const cb = row.querySelector('.bulk-check');
                if(cb) cb.checked = Boolean(!n?.sentEmail && n?.client.email);
            });
        });
    }, 50);
}

function showInvoice(id){const f=S.invoices[id];openDialog(`${docHtml(f,true)}<div class="noprint"><p>${statusLabels[f.status]} · ${esc(f.transmissionReference)}</p><div class="actions"><a href="/studio-parcelle-api?op=xml&id=${encodeURIComponent(id)}">Scarica XML</a>${button('Stampa / PDF','print')}${button('Registra esito invio','status',id)}</div></div>`,null);}
async function importDossier(){openDialog('<h2>Importa dal Dossier Clienti</h2><p>Caricamento…</p>',null);const r=await fetch('/studio-parcelle-api?op=dossier',{credentials:'same-origin'});if(!r.ok)throw Error('Dossier non disponibile: verificare accesso e percorso.');const d=await r.json();openDialog(`<h2>Importa dal Dossier Clienti</h2><input class="search" id="dossierSearch" placeholder="Cerca cliente" aria-label="Cerca nel dossier">${table(['Cliente',''],d.clients.map(c=>`<tr data-search="${esc(c.displayName.toLowerCase())}"><td>${esc(c.displayName)}</td><td>${button('Seleziona','chooseDossier',c.clientId)}</td></tr>`))}`,null);}
const actions={
    quickEditClientEmail:id=>quickEditClientEmail(id),
    prepareSendNoticeEmail:id=>prepareSendNoticeEmail(id),
    bulkNoticeEmailsModal:()=>bulkNoticeEmailsModal(),
    editServices:()=>editServices(),
    addServiceRow:()=>{$('#serviceRows').insertAdjacentHTML('beforeend',serviceRowHtml({description:'',amount:0,kind:'custom',key:''}));},
    addServiceToView:()=>{editServices();actions.addServiceRow();},
    removeServiceRow:(_,el)=>{if(document.querySelectorAll('#serviceRows .service-row').length>1)el.closest('.service-row').remove();},
    goToServices:()=>{if($('#dialog').open)$('#dialog').close();tab='services';render();},
    fetchAdempimenti:()=>loadAdempimentiForNotice(true),
    editNotice:id=>noticeEditor(id),
    refreshAddress:async(id,el)=>{el.disabled=true;try{const d=await fetchDossier(id),a=d.billingAddress||{};let filled=0;if(!el.isConnected)return;if(a.status==='found'&&['address','zip','city','province'].every(k=>!$('#form [name='+k+']').value.trim()))for(const k of ['address','zip','city','province']){$('#form [name='+k+']').value=a[k]||'';filled++;}const old=$('#addressResult');if(old)old.remove();el.insertAdjacentHTML('afterend','<div id="addressResult">'+addressNote(a)+(a.status==='found'?'<p class="note">'+filled+' campi compilati. Se l’indirizzo era già presente, è stato mantenuto integralmente. Indirizzo nel documento: '+esc(a.address)+', '+esc(a.zip)+' '+esc(a.city)+' ('+esc(a.province)+').</p>':'')+'</div>');}finally{el.disabled=false;}},
    numbering:()=>openDialog(`<h2>Numerazione fatture</h2><p>Inserisci l’ultimo progressivo già usato, anche nel precedente gestionale. La prossima fattura userà il numero successivo nel formato anno/numero. Il progressivo non può diminuire.</p>${input('year','Anno',today().slice(0,4),'number',true)}${input('last','Ultimo numero utilizzato',S.counters['F'+today().slice(0,4)]||0,'number',true)}`,async()=>save('numbering',getForm())),
    client:id=>clientEditor(id),
    studio:studioEditor,
    showNotice,
    showInvoice,
    import:importDossier,
    addLine:()=>{$('#lines').insertAdjacentHTML('beforeend',lineHtml());},
    removeLine:(_,el)=>{if(document.querySelectorAll('#lines .line').length>1)el.closest('.line').remove();updateTotal();},
    print:()=>window.print(),
    chooseDossier:async id=>{const existing=values(S.clients).find(c=>c.dossierId===id);if(existing)return clientEditor(existing.id);const d=await fetchDossier(id),a=d.billingAddress||{};clientEditor(null,{name:d.identity.displayName,cf:d.identity.taxCode||'',vat:d.identity.vatNumber||'',dossierId:d.clientId,address:a.status==='found'?a.address:'',zip:a.status==='found'?a.zip:'',city:a.status==='found'?a.city:'',province:a.status==='found'?a.province:'',billingAddress:a,email:'',sdi:'',pec:'',iban:''});},
    recurring:()=>openDialog(`<h2>Genera avvisi ricorrenti</h2><p>Verranno creati gli avvisi previsti dagli accordi attivi fino alla data indicata. La prossima data avanzerà per ogni accordo, evitando duplicati al successivo avvio.</p>${input('through','Fino al',today(),'date',true)}`,async()=>{const count=await save('recurring',getForm());message(`${count} avvisi ricorrenti creati.`);},'Genera avvisi'),
    payment:id=>{const n=S.notices[id];openDialog(`<h2>Registra incasso · ${esc(n.number)}</h2><p>Residuo ${eur(residual(n))}</p><div class="grid">${input('date','Data incasso',today(),'date',true)}${input('amount','Importo ricevuto (€)',residual(n)/100,'number',true)}</div>${input('reference','Riferimento bonifico / nota')}<p class="note">Registrato l'incasso, potrai creare immediatamente la relativa fattura elettronica pro-quota conforme allo standard SdI.</p>`,async()=>save('payment',{id,...getForm()}),'Registra incasso');},
    invoice:target=>{const parts=String(target).split(':');const id=parts[0],paymentId=parts[1]||'';const n=S.notices[id];const p=paymentId?n.payments.find(pm=>pm.id===paymentId):null;const amount=p?p.amount:pendingToInvoice(n);openDialog(`<h2>Crea fattura XML ${p?'pro-quota':''}</h2><p>Avviso ${esc(n.number)} · ${esc(n.client.name)} · Importo netto da fatturare: <b>${eur(amount)}</b></p>${input('date','Data fattura',today(),'date',true)}<p class="note">Verrà generata una fattura elettronica TD01 con ripartizione proporzionale di compensi, cassa, IVA e ritenuta ${p?'riferita all’incasso selezionato':'per tutti gli incassi pendenti'}. Il file XML sarà validato con lo schema ministeriale XSD.</p>`,async()=>save('invoice',{id,paymentId,...getForm()}),'Conferma e crea XML');},
    cancel:id=>openDialog('<h2>Annulla avviso</h2><p>L’avviso resterà nello storico e sarà escluso dalle previsioni. Il numero non verrà riutilizzato.</p>',async()=>save('cancel',{id}),'Conferma annullamento'),
    status:id=>openDialog(`<h2>Registra esito trasmissione</h2>${select('status','Stato',Object.entries(statusLabels),S.invoices[id].status)}${input('reference','Identificativo invio / riferimento ricevuta',S.invoices[id].transmissionReference)}<p class="note">Annotazione manuale: nessun invio viene effettuato da questa schermata. Per una fattura scartata, la correzione e il nuovo invio vanno gestiti nel servizio di fatturazione.</p>`,async()=>save('status',{id,...getForm()})),
    csv:()=>{const quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const rows=[['Numero','Data','Cliente','Compensi','IVA','Lordo','Ritenuta','Netto','Stato'],...values(S.invoices).map(f=>[f.number,f.date,f.client.name,...['base','vat','gross','withholding','net'].map(k=>(f.totals[k]/100).toFixed(2)),statusLabels[f.status]])];const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='fatture.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
};
window.onQuartersChanged=()=>{if($('#adempimentiStatus'))loadAdempimentiForNotice(true);};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b||busy)return;try{await actions[b.dataset.action]?.(b.dataset.id,b);}catch(err){message(err.message);if($('#dialog').open){const p=document.createElement('p');p.className='note';p.textContent=err.message;$('#formBody').prepend(p);}}});
document.addEventListener('change',e=>{if(e.target.name==='deliveryChannel')syncDelivery();});
document.addEventListener('input',e=>{if(e.target.id==='search'||e.target.id==='dossierSearch'){const root=e.target.id==='search'?$('#view'):$('#formBody');root.querySelectorAll('[data-search]').forEach(row=>row.hidden=!row.dataset.search.includes(e.target.value.toLowerCase()));}else if(e.target.closest('#form'))updateTotal();});
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render();});
$('#reload').onclick=load;$('#newNotice').onclick=()=>noticeEditor();$('#closeDialog').onclick=()=>{if(!busy)$('#dialog').close();};$('#dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('#form').onsubmit=async e=>{e.preventDefault();if(busy||!submitAction)return;busy=true;$('#submit').disabled=true;try{const result=await submitAction();if(result!==false)$('#dialog').close();}catch(err){const p=document.createElement('p');p.className='note';p.setAttribute('role','alert');p.textContent=err.message;$('#formBody').prepend(p);}finally{busy=false;$('#submit').disabled=false;}};
load();
