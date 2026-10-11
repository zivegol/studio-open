const $=id=>document.getElementById(id);
let selected=null,csrf='';
const titles={overview:'La scrivania fiscale',cliente:'Clienti dello studio',deleghe:'Registro deleghe',cassetto:'Documenti del cassetto',f24:'Versamenti F24',fatture:'Fatture elettroniche',cu:'CU · servizio massivo',verifiche:'Verifiche anagrafiche',archivio:'Archivio del cliente',operations:'Operazioni',audit:'Registro attività',entratel:'Connessioni e configurazione',studio:'Connessioni e configurazione'};
// Keep the existing service forms and event handlers, with one workspace route.
const f24=document.createElement('div');f24.id='tab-f24';f24.className='tab-panel';
const f24Card=[...$('tab-cassetto').children].find(e=>e.contains($('cassetto-f24-btn')));
if(f24Card)f24.append(f24Card);$('operativo').append(f24);
function route(){
 const requested=location.hash.slice(1),name=titles[requested]?requested:'overview';
 for(const section of document.querySelectorAll('main > section'))section.classList.add('workspace-hidden');
 for(const panel of document.querySelectorAll('.tab-panel'))panel.classList.remove('active');
 const panel=$('tab-'+name);
 if(panel){$('operativo').classList.remove('workspace-hidden');panel.classList.add('active');}
 else if(name==='entratel'||name==='studio'){$('entratel').classList.remove('workspace-hidden');$('studio').classList.remove('workspace-hidden');}
 else $(name)?.classList.remove('workspace-hidden');
 $('workspace-title').textContent=titles[name];
 document.querySelectorAll('aside nav a').forEach(a=>{const active=a.hash==='#'+name;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 if(name==='operations')loadOperations();if(name==='deleghe')loadDelegations();
 window.scrollTo({top:0});
}
window.addEventListener('hashchange',route);route();
window.addEventListener('ade-client',event=>{
 selected=event.detail;$('workspace-client').textContent=`${selected.name} · ${selected.taxCode}`;
 $('delegation-client').value=selected.taxCode;
});
async function read(op){const r=await fetch('/studio-ade-api?op='+op,{credentials:'same-origin',cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Servizio non disponibile');return d;}
async function bootstrap(){try{const d=await read('bootstrap');csrf=d.requesttoken;$('workspace-user').textContent=d.user;$('workspace-api-status').textContent=d.configured?'Verifiche anagrafiche configurate':'Verifiche anagrafiche da configurare';$('workspace-cu-status').textContent=d.cuConfigured?'Credenziali CU configurate · consultare gli esiti':'Configurazione CU da completare';}catch(e){$('workspace-api-status').textContent=e.message;$('workspace-cu-status').textContent='Stato non disponibile';}}
bootstrap();
function table(target,headers,rows){const wrap=$(target);wrap.replaceChildren();if(!rows.length){wrap.textContent='Nessuna operazione registrata.';return;}const t=document.createElement('table');t.className='workspace-table';const head=t.createTHead().insertRow();headers.forEach(h=>{const th=document.createElement('th');th.textContent=h;head.append(th);});const body=t.createTBody();rows.forEach(cells=>{const row=body.insertRow();cells.forEach(value=>{row.insertCell().textContent=value??'—';});});wrap.append(t);}
async function loadOperations(){
 $('operations-status').textContent='Caricamento operazioni…';
 const results=await Promise.allSettled([read('cu-history'),read('audit-log')]);
 if(results[0].status==='fulfilled'){const d=results[0].value;table('operations-cu',['Protocollo','Stato','Data','Soggetti'],(d.requests||d.history||[]).map(r=>[r.protocollo,r.status,r.submittedAt,r.numClients]));}
 if(results[1].status==='fulfilled')table('operations-log',['Data','Operazione','Cliente','Esito'],(results[1].value.logs||[]).slice(0,25).map(r=>[r.timestamp,r.operation,r.client,r.status]));
 $('operations-status').textContent=results.some(r=>r.status==='rejected')?'Alcuni servizi non sono disponibili. Nessun invio è stato effettuato.':'Registro aggiornato. Le richieste CU già inviate restano conservate sul server.';
}
$('operations-refresh').addEventListener('click',loadOperations);
window.addEventListener('ade-operation',event=>{$('operations-current').textContent=event.detail;});
async function loadDelegations(){try{const d=await read('delegations');table('delegation-list',['Cliente','Servizio','Scadenza','Stato locale','Riferimento'],d.delegations.map(r=>[r.client,r.service,r.expires,r.revoked?'Revocata':r.expires<new Date().toISOString().slice(0,10)?'Scaduta':'Registrata',r.reference]));}catch(e){$('delegation-status').textContent=e.message;}}
$('delegation-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
 try{const payload=Object.fromEntries(new FormData(form));payload.revoked=payload.revoked==='on';
 const r=await fetch('/studio-ade-api?op=delegations',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',requesttoken:csrf},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw Error(d.error||'Salvataggio non riuscito');
 $('delegation-status').textContent='Registrazione salvata. La delega sul portale Agenzia non è stata modificata.';await loadDelegations();
 }catch(e){$('delegation-status').textContent=e.message;}finally{button.disabled=false;}
});
