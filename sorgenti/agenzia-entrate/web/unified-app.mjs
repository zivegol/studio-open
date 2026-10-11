/**
 * studio-example - Servizi Agenzia delle Entrate
 * Unified App: Entratel Login, Utenza Studio, Selezione Cliente, Cassetto Fiscale, Fatture SDI, CU Massivo, Verifiche
 */

const $ = id => document.getElementById(id);

let csrf = '';
let connected = false;
let busy = false;
let pendingJob = null;
let allClients = [];
let selectedClient = null;
let activeFilter = 'all'; // 'all', 'DI', 'PF', 'PG'
let countdownInterval = null;
let cachedClientDocs = [];
let currentDeclarationModel = null;
let currentDeclarationYears = null;

// Sidebar links and tabs must activate the same panel, including direct URLs.
function activateHash(){
  const name=location.hash.slice(1);
  const panel=$('tab-'+name);
  if(!panel)return;
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p===panel));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.target===panel.id));

  if(name === 'audit') loadAuditLog();
}
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{
  const hash='#'+btn.dataset.target.replace(/^tab-/,'');
  if(location.hash===hash)activateHash();else location.hash=hash;
}));
document.querySelectorAll('aside nav a').forEach(a=>a.addEventListener('click',()=>{
  if(location.hash===a.getAttribute('href'))activateHash();
}));
window.addEventListener('hashchange',activateHash);
activateHash();

// Generic API call
async function api(input) {
  const r = await fetch('/studio-ade-api', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', requesttoken: csrf },
    body: JSON.stringify(input)
  });
  let d;
  try { d = await r.json(); }
  catch { throw new Error('Risposta del servizio non valida.'); }
  if (!r.ok) {
    if (r.status === 401) {
      connected = false;
      updateConnectionStatus('idle', d.error || 'Sessione scaduta.');
    }
    throw new Error(d.error || 'Operazione non riuscita.');
  }
  return d;
}

// -------------------------------------------------------------
// 1. GESTIONE CONNESSIONE ENTRATEL & SALVAVITA PIN
// -------------------------------------------------------------

function updateCircuitBreakerUI(circuitTripped, circuitReason) {
  const banner = $('entratel-circuit-banner');
  const reasonSpan = $('entratel-circuit-reason');
  if (!banner) return;
  if (circuitTripped) {
    banner.style.display = 'block';
    if (reasonSpan) {
      reasonSpan.textContent = circuitReason || 'Il connettore è temporaneamente bloccato per salvaguardare il PIN Entratel dello studio.';
    }
  } else {
    banner.style.display = 'none';
  }
}

async function refreshCircuitStatus() {
  try {
    const st = await api({ op: 'circuit-status' });
    updateCircuitBreakerUI(Boolean(st.tripped), st.reason);
  } catch {}
}

const circuitResetBtn = $('entratel-circuit-reset-btn');
if (circuitResetBtn) {
  circuitResetBtn.addEventListener('click', async () => {
    try {
      circuitResetBtn.disabled = true;
      circuitResetBtn.textContent = 'Sblocco in corso…';
      await api({ op: 'circuit-reset' });
      updateCircuitBreakerUI(false);
      alert('Salvavita connettore ripristinato con successo.');
    } catch (e) {
      alert('Errore sblocco connettore: ' + e.message);
    } finally {
      circuitResetBtn.disabled = false;
      circuitResetBtn.textContent = '🔓 Sblocca connettore';
    }
  });
}

function updateConnectionStatus(state, msg) {
  const badge = $('entratel-badge');
  const banner = $('entratel-banner');
  const loginFields = $('entratel-login-fields');
  const logoutBtn = $('entratel-logout-btn');
  const resumeBtn = $('entratel-resume-btn');

  if (banner) {
    banner.dataset.state = state === 'connected' ? 'ok' : state === 'error' ? 'error' : state === 'pending' ? 'pending' : '';
    banner.textContent = msg;
  }

  if (badge) {
    badge.className = 'badge ' + (state === 'connected' ? 'badge-green' : state === 'pending' ? 'badge-amber' : 'badge-gray');
    badge.textContent = state === 'connected' ? '✓ Collegato ad Entratel' : state === 'pending' ? '⏳ Accesso in corso…' : '○ Non collegato';
  }

  if (loginFields) loginFields.disabled = (state === 'connected' || busy);
  if (logoutBtn) logoutBtn.disabled = (state !== 'connected' || busy);
  if (resumeBtn) resumeBtn.hidden = !pendingJob;

  // Enable or disable actions that require Entratel connection
  const entratelActions = document.querySelectorAll('.requires-entratel');
  entratelActions.forEach(el => {
    el.disabled = !connected || busy || !selectedClient;
  });
  refreshDocumentButtons();
  queueMicrotask(autoLoadDocuments);
}

async function pollJob(id, onComplete) {
  pendingJob = id;
  $('entratel-resume-btn').hidden = false;
  for (let n = 0; n < 120; n++) {
    const job = await api({ op: 'job', id });
    if (job.state === 'failed') {
      if (job.connected === false) {
        connected = false;
        updateConnectionStatus('error', job.error || 'Sessione Entratel interrotta.');
      }
      await api({ op: 'ack', id }).catch(() => {});
      pendingJob = null;
      $('entratel-resume-btn').hidden = true;
      await refreshCircuitStatus();
      throw new Error(job.error || 'Operazione fallita sul portale.');
    }
    if (job.state === 'complete') {
      await api({ op: 'ack', id }).catch(() => {});
      pendingJob = null;
      $('entratel-resume-btn').hidden = true;
      if (onComplete) await onComplete(job.result);
      return job.result;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Operazione ancora in corso. Usa «Riprendi operazione» tra poco.');
}

async function performEntratelOp(op, input = {}, onComplete = null) {
  window.dispatchEvent(new CustomEvent("ade-operation",{detail:"Operazione in corso: "+op}));
  if (busy) return;
  busy = true;
  updateConnectionStatus(connected ? 'connected' : 'pending', op === 'login' ? 'Connessione al portale Entratel in corso…' : 'Elaborazione in corso sul portale dell’Agenzia…');
  try {
    const job = await api({ op, ...input });
    if (input.credentials) {
      input.credentials.username = '';
      input.credentials.password = '';
      input.credentials.pin = '';
    }
    const result = await pollJob(job.id, onComplete);
    window.dispatchEvent(new CustomEvent("ade-operation",{detail:"Operazione completata: "+op}));
    return result;
  } catch (e) {
    if (op === 'login') {
      connected = false;
      updateConnectionStatus('error', e.message);
    }
    window.dispatchEvent(new CustomEvent("ade-operation",{detail:"Operazione interrotta: "+op+". "+e.message}));
    await refreshCircuitStatus();
    throw e;
  } finally {
    busy = false;
    if (connected) {
      updateConnectionStatus('connected', 'Sessione Entratel aperta e operativa.');
    } else if (op !== 'login') {
      updateConnectionStatus('idle', 'Inserisci le credenziali Entratel per iniziare.');
    }
  }
}

// Form login Entratel
const entratelForm = $('entratel-form');
if (entratelForm) {
  entratelForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(entratelForm);
    const username = (data.get('username') || '').toString().trim();
    const password = (data.get('password') || '').toString();
    const pin = (data.get('pin') || '').toString().trim();
    if (!username || !password || !pin) {
      alert('Inserisci Nome utente, Password e PIN Entratel.');
      return;
    }
    try {
      await performEntratelOp('login', { credentials: { username, password, pin } }, result => {
        connected = true;
        entratelForm.reset();
        updateConnectionStatus('connected', 'Accesso al portale Entratel confermato con successo!');
      });
    } catch (err) {
      alert('Errore di accesso: ' + err.message);
    }
  });
}

// Logout Entratel
const logoutBtn = $('entratel-logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (!confirm('Vuoi chiudere la sessione Entratel?')) return;
    try {
      await api({ op: 'logout' });
      connected = false;
      pendingJob = null;
      updateConnectionStatus('idle', 'Sessione Entratel chiusa. Puoi effettuare un nuovo accesso.');
    } catch (e) {
      alert(e.message);
    }
  });
}

// Riprendi operazione
const resumeBtn = $('entratel-resume-btn');
if (resumeBtn) {
  resumeBtn.addEventListener('click', async () => {
    if (!pendingJob || busy) return;
    try {
      await pollJob(pendingJob, () => {
        alert('Operazione completata con successo!');
      });
    } catch (e) {
      alert(e.message);
    }
  });
}

// -------------------------------------------------------------
// 2. UTENZA STUDIO & SELEZIONE CLIENTE
// -------------------------------------------------------------

function getActiveStudio() {
  const input = $('ade-studio');
  return (input ? input.value : '00000000000').trim().toUpperCase();
}

function renderClientList() {
  const container = $('client-list-container');
  const searchVal = ($('client-search-input')?.value || '').toLowerCase().trim();
  if (!container) return;

  const filtered = allClients.filter(c => {
    // Type filter
    if (activeFilter === 'DI' && c.type !== 'DI') return false;
    if (activeFilter === 'PF' && c.type !== 'PF') return false;
    if (activeFilter === 'PG' && c.type !== 'PG') return false;
    // Search filter
    if (searchVal) {
      const hay = `${c.name} ${c.taxCode} ${c.vatNumber || ''}`.toLowerCase();
      if (!hay.includes(searchVal)) return false;
    }
    return true;
  });

  container.replaceChildren();
  if (!filtered.length) {
    container.innerHTML = '<p class="muted" style="padding:14px;text-align:center">Nessun cliente corrispondente ai filtri.</p>';
    return;
  }

  for (const c of filtered) {
    const item = document.createElement('div');
    item.className = 'cu-client-row';
    const isSelected = selectedClient && selectedClient.id === c.id;
    item.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #e2e8f0;cursor:pointer;background:${isSelected ? '#e0f2fe' : '#fff'};border-radius:6px;margin-bottom:4px;transition:background 0.1s ease;`;

    const left = document.createElement('div');
    left.innerHTML = `<strong>${c.name}</strong><br><span style="font-size:12px;color:#475569">CF: <code>${c.taxCode}</code> ${c.vatNumber ? '· P.IVA: <code>' + c.vatNumber + '</code>' : ''}</span>`;

    const badge = document.createElement('span');
    badge.className = 'badge ' + (c.type === 'PG' ? 'badge-gray' : c.type === 'DI' ? 'badge-blue' : 'badge-green');
    badge.textContent = c.typeLabel;

    item.append(left, badge);
    item.addEventListener('click', () => selectClient(c));
    container.append(item);
  }
}

function selectClient(c) {
  selectedClient = c;
  window.dispatchEvent(new CustomEvent("ade-client",{detail:{name:c.name,taxCode:c.taxCode}}));
  attemptedTypes='';attemptedYears='';
  resetDocumentChoices();
  renderClientList();

  // Update active client card
  const card = $('active-client-card');
  if (card) {
    card.hidden = false;
    $('active-client-name').textContent = c.name;
    $('active-client-cf').textContent = c.taxCode;
    $('active-client-piva').textContent = c.vatNumber || '—';
    const b = $('active-client-type');
    b.className = 'badge ' + (c.type === 'PG' ? 'badge-gray' : c.type === 'DI' ? 'badge-blue' : 'badge-green');
    b.textContent = c.typeLabel;

    let folderBtn = $('active-client-folder-link');
    if (!folderBtn) {
      folderBtn = document.createElement('a');
      folderBtn.id = 'active-client-folder-link';
      folderBtn.target = '_blank';
      folderBtn.className = 'button secondary';
      folderBtn.style.cssText = 'padding:4px 10px;font-size:12px;display:inline-flex;align-items:center;gap:4px;text-decoration:none';
      b?.parentElement?.append(folderBtn);
    }
    folderBtn.href = `/apps/files/?dir=/Studio/AgenziaEntrate/${encodeURIComponent(c.taxCode)}`;
    folderBtn.innerHTML = '📁 Cartella Nextcloud';
  }

  // Update inputs in all forms
  if ($('verify-cf-input')) $('verify-cf-input').value = c.taxCode;
  if ($('verify-piva-input')) $('verify-piva-input').value = c.vatNumber || '';

  // Refresh requires-entratel buttons
  document.querySelectorAll('.requires-entratel').forEach(el => {
    el.disabled = !connected || busy;
  });

  // Load local archive and F24 analysis for this client
  loadClientArchive(c.taxCode);
  loadF24Analysis(c.taxCode);
  queueMicrotask(autoLoadDocuments);
}

// Filter chips
document.querySelectorAll('.filter-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chips .chip').forEach(ch => ch.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.type;
    renderClientList();
  });
});

if ($('client-search-input')) {
  $('client-search-input').addEventListener('input', renderClientList);
}

// -------------------------------------------------------------
// 3. CASSETTO FISCALE (DICHIARAZIONI & F24)
// -------------------------------------------------------------

// Scarico Dichiarazione Completa PDF
const declBtn = $('cassetto-decl-btn');
const declStatus = $('cassetto-decl-status');
let documentContext = '';
let attemptedTypes='',attemptedYears='';
function autoLoadDocuments(){
  if(!connected||busy||pendingJob||!selectedClient)return;
  const key=documentKey(),model=$('cassetto-decl-model')?.value;
  if(attemptedTypes!==key){attemptedTypes=key;loadDocumentChoices('types');return;}
  if(documentContext===key&&model&&attemptedYears!==`${key}:${model}`){
    attemptedYears=`${key}:${model}`;loadDocumentChoices('years');
  }
}
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function renderDeclarationTable(model, years) {
  currentDeclarationModel = model;
  currentDeclarationYears = years;
  const container = $('cassetto-decl-results');
  if (!container) return;
  if (!years || !years.length) {
    container.innerHTML = `<div class="banner" style="background:#f1f5f9;color:#475569;margin-top:10px">
      ℹ️ Nessun documento presente sul portale per <strong>${escapeHtml(model || 'il modello selezionato')}</strong> per questo cliente.
    </div>`;
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `<thead>
    <tr>
      <th>Modello / Tipologia</th>
      <th>Annualità / Periodo</th>
      <th style="text-align:right">Azione / Visualizzazione</th>
    </tr>
  </thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  for (const y of years) {
    const row = document.createElement('tr');
    row.innerHTML = `<td><strong>${escapeHtml(model || 'Dichiarazione')}</strong></td>
      <td>${escapeHtml(y.label || y.value)}</td>
      <td style="text-align:right"></td>`;

    const actionTd = row.querySelectorAll('td')[2];

    // Check if this model and year is already cached in archive
    const yearDigits = String(y.value || y.label).match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
    const normModel = String(model || '').toLowerCase();
    const existingDoc = cachedClientDocs.find(d => {
      const dYear = String(d.year || d.label || d.title || '');
      const dModel = String(d.model || d.kind || d.title || '').toLowerCase();
      const matchYear = yearDigits ? dYear.includes(yearDigits) : false;
      const matchModel = normModel ? (dModel.includes(normModel) || normModel.includes(dModel)) : true;
      return matchYear && matchModel;
    });

    const createActionContent = (doc) => {
      actionTd.replaceChildren();
      if (doc && doc.id) {
        const viewUrl = `/studio-ade-api?op=document&client=${encodeURIComponent(selectedClient.taxCode)}&id=${encodeURIComponent(doc.id)}`;
        const downUrl = `${viewUrl}&download=1`;

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;';
        wrap.innerHTML = `
          <span class="badge" style="background:#dcfce7;color:#15803d;font-weight:600;font-size:11px;padding:3px 7px;border-radius:4px">✓ In Archivio</span>
          <a href="${viewUrl}" target="_blank" class="button" style="background:#0284c7;color:#fff;padding:5px 12px;font-size:12px;border-radius:4px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;font-weight:600">👁️ Apri PDF</a>
          <a href="${downUrl}" class="button secondary" style="padding:5px 10px;font-size:12px;border-radius:4px;text-decoration:none" title="Scarica file sul computer">💾</a>
        `;

        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'secondary';
        reloadBtn.style.cssText = 'padding:5px 8px;font-size:11px;color:#64748b;margin-left:2px;';
        reloadBtn.title = 'Riscarica copia aggiornata dal portale Entratel';
        reloadBtn.textContent = '🔄';
        reloadBtn.addEventListener('click', () => triggerDownload(reloadBtn));
        wrap.append(reloadBtn);

        actionTd.append(wrap);
      } else {
        const btn = document.createElement('button');
        btn.className = 'secondary';
        btn.style.padding = '5px 12px';
        btn.style.fontSize = '12px';
        btn.textContent = '📥 Scarica PDF';
        btn.addEventListener('click', () => triggerDownload(btn));
        actionTd.append(btn);
      }
    };

    const triggerDownload = async (btn) => {
      if (!selectedClient) { alert('Seleziona prima un cliente.'); return; }
      if (!connected) { alert('Effettua prima l’accesso ad Entratel.'); return; }
      const currentClient = { ...selectedClient };
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = '⏳ Scarico…';
      declStatus.className = 'banner';
      declStatus.dataset.state = 'pending';
      declStatus.textContent = `Scaricamento di ${model} (${y.label || y.value}) per ${currentClient.name} in corso…`;

      try {
        await performEntratelOp('declaration-download', {
          studio: getActiveStudio(),
          model: model,
          year: y.value,
          client: currentClient.taxCode
        }, result => {
          const doc = result?.document;
          const docId = doc?.id;
          const viewUrl = docId ? `/studio-ade-api?op=document&client=${encodeURIComponent(currentClient.taxCode)}&id=${encodeURIComponent(docId)}` : '';

          declStatus.className = 'banner';
          declStatus.dataset.state = 'ok';
          declStatus.innerHTML = `✓ Documento <strong>${escapeHtml(model)} (${escapeHtml(y.label || y.value)})</strong> archiviato con successo in Nextcloud! ` +
            (viewUrl ? `<a href="${viewUrl}" target="_blank" style="margin-left:10px;font-weight:700;color:#0284c7;text-decoration:underline">👁️ Apri subito il PDF</a>` : '');

          if (doc) {
            cachedClientDocs = [doc, ...cachedClientDocs.filter(d => d.id !== doc.id)];
            createActionContent(doc);
          } else {
            btn.textContent = '✓ Salvata in NC';
            btn.style.background = '#dcfce7';
            btn.style.color = '#15803d';
          }
          if (selectedClient?.taxCode === currentClient.taxCode) {
            loadClientArchive(currentClient.taxCode);
          }
        });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = oldText;
        declStatus.className = 'banner';
        declStatus.dataset.state = 'error';
        declStatus.textContent = `Errore download ${model}: ${err.message}`;
      }
    };

    createActionContent(existingDoc);
    tbody.append(row);
  }

  container.replaceChildren(table);
}

function documentKey(){return `${getActiveStudio()}:${selectedClient?.taxCode || ''}`;}
function fillDocumentChoices(id,items,empty){
  const select=$(id);
  if(!select)return;
  select.replaceChildren(new Option(empty,''));
  for(const item of items)select.add(new Option(item.label,item.value));
  if(items.length)select.value=items[0].value;
}
function refreshDocumentButtons(){
  const ready=connected&&!busy&&selectedClient&&documentContext===documentKey();
  const m=$('cassetto-decl-model'),y=$('cassetto-decl-year'),b=$('cassetto-decl-btn'),rb=$('cassetto-decl-reload-btn');
  if(m)m.disabled=!ready;
  if(y)y.disabled=!ready;
  if(b)b.disabled=!(ready&&m?.value&&y?.value);
  if(rb)rb.disabled=!connected||busy||!selectedClient;
}
function resetDocumentChoices(){
  currentDeclarationModel = null;
  currentDeclarationYears = null;
  documentContext='';
  fillDocumentChoices('cassetto-decl-model',[],'Carica prima le tipologie');
  fillDocumentChoices('cassetto-decl-year',[],'Scegli prima la tipologia');
  const res = $('cassetto-decl-results');
  if (res) res.replaceChildren();
  refreshDocumentButtons();
}
if($('cassetto-decl-model')){
  $('cassetto-decl-model').addEventListener('change',()=>{
    attemptedYears='';
    fillDocumentChoices('cassetto-decl-year',[],'Caricamento annualità…');
    const res = $('cassetto-decl-results');
    if (res) res.innerHTML = '<p class="muted" style="padding:10px 0">Caricamento documenti disponibili…</p>';
    refreshDocumentButtons();
    autoLoadDocuments();
  });
}
if($('cassetto-decl-year')){
  $('cassetto-decl-year').addEventListener('change',refreshDocumentButtons);
}
const declReloadBtn=$('cassetto-decl-reload-btn');
if(declReloadBtn){
  declReloadBtn.addEventListener('click',()=>{
    attemptedTypes='';
    attemptedYears='';
    resetDocumentChoices();
    loadDocumentChoices('types');
  });
}
async function loadDocumentChoices(kind){
  const key=documentKey(),model=$('cassetto-decl-model')?.value;
  if(!connected||busy||!selectedClient)return;
  if(kind==='types')resetDocumentChoices();
  else fillDocumentChoices('cassetto-decl-year',[],'Caricamento…');
  declStatus.textContent='Lettura del cassetto fiscale in corso…';
  try{
    await performEntratelOp('document-'+kind,{studio:getActiveStudio(),client:selectedClient.taxCode,model},result=>{
      if(key!==documentKey()||(kind==='years'&&model!==$('cassetto-decl-model')?.value))return;
      documentContext=key;
      const items=result[kind]||[];
      fillDocumentChoices(kind==='types'?'cassetto-decl-model':'cassetto-decl-year',items,items.length?'Seleziona…':'Nessuna voce disponibile');
      declStatus.textContent=items.length?`✓ ${items.length} ${kind==='types'?'modelli disponibili':'annualità disponibili'}.`:'Nessuna voce disponibile rilevata sul portale.';

      if(kind==='years'){
        renderDeclarationTable(model, items);
      }

      // Se abbiamo caricato i tipi e ce n'è almeno uno, carichiamo subito le annualità
      if(kind==='types'&&items.length>0){
        const firstVal=$('cassetto-decl-model').value;
        if(firstVal){
          attemptedYears=`${key}:${firstVal}`;
          loadDocumentChoices('years');
        }
      }
    });
  }catch(e){
    attemptedTypes='';
    attemptedYears='';
    declStatus.textContent='Errore lettura cassetto: '+e.message;
  }
  finally{refreshDocumentButtons();}
}
if (declBtn) {
  declBtn.addEventListener('click', async () => {
    if (!selectedClient) { alert('Seleziona prima un cliente.'); return; }
    if (!connected) { alert('Effettua prima l’accesso ad Entratel.'); return; }
    if(documentContext!==documentKey()||!$('cassetto-decl-model').value||!$('cassetto-decl-year').value)return;
    const downloadClient={...selectedClient};

    declBtn.disabled = true;
    declStatus.textContent = 'Apertura cassetto delegato ed estrazione dichiarazione dei redditi in corso…';
    declStatus.className = 'banner';
    declStatus.dataset.state = 'pending';

    try {
      await performEntratelOp('declaration-download', {
        studio: getActiveStudio(),
        model: $('cassetto-decl-model').value,
        year: $('cassetto-decl-year').value,
        client: selectedClient.taxCode
      }, result => {
        declStatus.className = 'banner';
        declStatus.dataset.state = 'ok';
        declStatus.textContent = `Documento scaricato e archiviato in Nextcloud per ${downloadClient.name}.`;
        if(selectedClient?.taxCode===downloadClient.taxCode)loadClientArchive(downloadClient.taxCode);
      });
    } catch (e) {
      declStatus.className = 'banner';
      declStatus.dataset.state = 'error';
      declStatus.textContent = 'Errore estrazione dichiarazione: ' + e.message;
    } finally {
      refreshDocumentButtons();
    }
  });
}

// -------------------------------------------------------------
// 4.2 VERSAMENTI F24 & ANALISI FISCALE MULTIDIMENSIONALE
// -------------------------------------------------------------

const TRIBUTI_DICT = {
  // Erario - Ritenute
  '1001': 'Ritenute su retribuzioni e pensioni',
  '1004': 'Ritenute su indennità fine rapporto',
  '1040': 'Ritenute d’acconto su redditi di lavoro autonomo',
  '1038': 'Ritenute su provvigioni',
  // Erario - IVA
  '6001': 'Versamento IVA mensile Gennaio',
  '6002': 'Versamento IVA mensile Febbraio',
  '6003': 'Versamento IVA mensile Marzo',
  '6004': 'Versamento IVA mensile Aprile',
  '6005': 'Versamento IVA mensile Maggio',
  '6006': 'Versamento IVA mensile Giugno',
  '6007': 'Versamento IVA mensile Luglio',
  '6008': 'Versamento IVA mensile Agosto',
  '6009': 'Versamento IVA mensile Settembre',
  '6010': 'Versamento IVA mensile Ottobre',
  '6011': 'Versamento IVA mensile Novembre',
  '6012': 'Versamento IVA mensile Dicembre',
  '6031': 'Versamento IVA 1° trimestre',
  '6032': 'Versamento IVA 2° trimestre',
  '6033': 'Versamento IVA 3° trimestre',
  '6034': 'Versamento IVA 4° trimestre',
  '6099': 'Versamento IVA annuale a saldo',
  // Erario - Imposte Dirette
  '4001': 'IRPEF - Saldo',
  '4033': 'IRPEF - Acconto prima rata',
  '4034': 'IRPEF - Acconto seconda rata o unica',
  '2001': 'IRES - Saldo',
  '2002': 'IRES - Acconto prima rata',
  '2003': 'IRES - Acconto seconda rata o unica',
  '1795': 'Imposta sostitutiva forfettario - Saldo',
  '1793': 'Imposta sostitutiva forfettario - Acconto 1a rata',
  '1794': 'Imposta sostitutiva forfettario - Acconto 2a rata',
  '1842': 'Cedolare secca locazioni - Saldo',
  '1840': 'Cedolare secca locazioni - Acconto 1a rata',
  '1841': 'Cedolare secca locazioni - Acconto 2a rata',
  // Regioni
  '3801': 'Addizionale regionale all’IRPEF',
  '3805': 'IRAP - Saldo',
  '3812': 'IRAP - Acconto prima rata',
  '3813': 'IRAP - Acconto seconda rata o unica',
  // Enti Locali / IMU
  '3844': 'Addizionale comunale all’IRPEF - Saldo',
  '3843': 'Addizionale comunale all’IRPEF - Acconto',
  '3918': 'IMU - Altri fabbricati (Comune)',
  '3912': 'IMU - Abitazione principale e pertinenze',
  '3914': 'IMU - Terreni',
  '3916': 'IMU - Aree fabbricabili',
  '3925': 'IMU - Immobili uso produttivo Cat. D (Stato)',
  '3930': 'IMU - Immobili uso produttivo Cat. D (Comune)',
  // Sanzioni e Interessi
  '8906': 'Sanzione pecuniaria IRPEF / Sostitutiva',
  '8904': 'Sanzione pecuniaria IVA',
  '8901': 'Sanzione pecuniaria Ritenute',
  '1989': 'Interessi ravvedimento operoso IRPEF',
  '1991': 'Interessi ravvedimento operoso IVA',
  '1990': 'Interessi ravvedimento operoso IRES',
  // Crediti in compensazione
  '6781': 'Credito imposta compensazione mod. 770',
  '6782': 'Credito imposta compensazione lavoro autonomo',
  '6897': 'Credito transizione 4.0 / 5.0 beni strumentali',
  // INPS
  'DM10': 'Contributi previdenziali dipendenti INPS',
  'CXX': 'Contributi gestione commercianti INPS',
  'CP': 'Contributi gestione artigiani INPS',
  'RC': 'Gestione separata INPS committenti',
  'P10': 'Gestione separata INPS liberi professionisti'
};

function getTributoDescription(codice) {
  if (!codice) return '';
  const clean = String(codice).trim().toUpperCase();
  return TRIBUTI_DICT[clean] || '';
}

function parseItalianDate(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const y = parseInt(m[3].length === 2 ? `20${m[3]}` : m[3], 10);
  return new Date(y, mo, d);
}

function formatEuro(num) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(num || 0);
}

let f24AnalysisData = { models: [], tributi: [] };
let activeF24Year = '2026';
let f24LivePortalRecordsByYear = {}; // year -> records[]
let f24SubTab = 'models'; // 'models' | 'tributisel' | 'quiesel'
const f24ExpandedRows = new Set(); // protocol set of expanded rows

function parseEuro(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const clean = String(val).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  return parseFloat(clean) || 0;
}

async function loadF24Analysis(taxCode) {
  const container = $('cassetto-f24-results');
  if (!container || !taxCode) return;

  try {
    const res = await fetch(`/studio-ade-api?op=f24-analysis&client=${encodeURIComponent(taxCode)}`, {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      f24AnalysisData = data;
    }
  } catch (e) {
    console.error('Error loading F24 analysis:', e);
  }
  renderF24CurrentView();
}

function renderF24CurrentView() {
  if (f24SubTab === 'models') {
    renderF24AnnualView();
  } else if (f24SubTab === 'tributisel') {
    renderF24TributiSelView();
  } else if (f24SubTab === 'quiesel') {
    renderF24QuieSelView();
  }
}

function switchF24Year(year) {
  activeF24Year = String(year);
  document.querySelectorAll('.f24-year-btn').forEach(btn => {
    const isAct = btn.dataset.year === activeF24Year;
    btn.classList.toggle('active', isAct);
    btn.style.background = isAct ? '#0284c7' : '';
    btn.style.color = isAct ? '#fff' : '';
  });

  if ($('f24-active-year-label')) $('f24-active-year-label').textContent = activeF24Year;
  if ($('f24-criteria-year-text')) $('f24-criteria-year-text').textContent = activeF24Year;
  if ($('f24-summary-year')) $('f24-summary-year').textContent = activeF24Year;
  document.querySelectorAll('.f24-kpi-year-badge').forEach(el => el.textContent = activeF24Year);

  // Vincola il datepicker strettamente all'anno selezionato
  const fromEl = $('f24-filter-from');
  const toEl = $('f24-filter-to');
  if (fromEl) {
    fromEl.min = `${activeF24Year}-01-01`;
    fromEl.max = `${activeF24Year}-12-31`;
    if (fromEl.value && !fromEl.value.startsWith(activeF24Year)) fromEl.value = '';
  }
  if (toEl) {
    toEl.min = `${activeF24Year}-01-01`;
    toEl.max = `${activeF24Year}-12-31`;
    if (toEl.value && !toEl.value.startsWith(activeF24Year)) toEl.value = '';
  }

  renderF24AnnualView();
}

// -------------------------------------------------------------
// VISTA 1: MODELLO F24 (PER ANNUALITÀ) - Stile Cassetto Fiscale
// -------------------------------------------------------------
function renderF24AnnualView() {
  const container = $('cassetto-f24-results');
  if (!container) return;

  if (!selectedClient) {
    container.innerHTML = `<p class="muted" style="padding:16px;text-align:center">Seleziona prima un cliente dal menu laterale per visualizzare i versamenti F24.</p>`;
    return;
  }

  // 1. Modelli archiviati per l'anno selezionato
  const archived = (f24AnalysisData.models || []).filter(m => {
    if (m.year && String(m.year) === activeF24Year) return true;
    const d = parseItalianDate(m.date);
    return d && String(d.getFullYear()) === activeF24Year;
  });

  // 2. Modelli estratti dal vivo dal portale per l'anno selezionato
  const combined = [...archived];
  const liveRecords = f24LivePortalRecordsByYear[activeF24Year] || [];
  for (const lp of liveRecords) {
    if (!combined.some(m => m.protocol && m.protocol === lp.protocol)) {
      const balNum = parseEuro(lp.balance);
      combined.push({
        docId: null,
        date: lp.date,
        year: activeF24Year,
        protocol: lp.protocol,
        balance: lp.balance,
        debito: balNum,
        credito: 0,
        saldo: balNum,
        tributiCount: 0,
        tributi: [],
        quadrato: false,
        downloadable: Boolean(lp.downloadable || lp.quietanzaUrl),
        quietanzaUrl: lp.quietanzaUrl
      });
    }
  }

  // Ordinamento per data decrescente
  combined.sort((a, b) => {
    const da = parseItalianDate(a.date) || new Date(0);
    const db = parseItalianDate(b.date) || new Date(0);
    return db - da;
  });

  // 3. Filtri temporali ed analitici sui versamenti acquisiti nell'anno
  const fromVal = $('f24-filter-from')?.value;
  const toVal = $('f24-filter-to')?.value;
  const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const toDate = toVal ? new Date(toVal + 'T23:59:59') : null;

  const enteVal = $('f24-filter-ente')?.value || 'all';
  const tributoQuery = ($('f24-filter-tributo')?.value || '').trim().toLowerCase();

  const filtered = combined.filter(m => {
    if (fromDate || toDate) {
      const d = parseItalianDate(m.date);
      if (d) {
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
      }
    }

    if (enteVal !== 'all') {
      if (m.tributi && m.tributi.length > 0) {
        const hasEnte = m.tributi.some(t => (t.sezione || '').toLowerCase().includes(enteVal.toLowerCase()));
        if (!hasEnte) return false;
      }
    }

    if (tributoQuery) {
      if (m.tributi && m.tributi.length > 0) {
        const hasTrib = m.tributi.some(t => {
          const c = (t.codice || '').toLowerCase();
          const desc = (getTributoDescription(t.codice) || '').toLowerCase();
          return c.includes(tributoQuery) || desc.includes(tributoQuery);
        });
        if (!hasTrib) return false;
      }
    }

    return true;
  });

  // 4. Calcolo Totali e Quadratura KPI dell'anno
  let sumDebito = 0;
  let sumCredito = 0;
  let sumSaldo = 0;

  for (const m of filtered) {
    if (m.tributi && m.tributi.length > 0) {
      sumDebito += (m.debito || 0);
      sumCredito += (m.credito || 0);
      sumSaldo += (m.debito - m.credito);
    } else {
      const b = typeof m.balance === 'number' ? m.balance : parseEuro(m.balance);
      sumSaldo += b;
      sumDebito += b;
    }
  }

  if ($('f24-kpi-debito')) $('f24-kpi-debito').textContent = formatEuro(sumDebito);
  if ($('f24-kpi-credito')) $('f24-kpi-credito').textContent = formatEuro(sumCredito);
  if ($('f24-kpi-saldo')) $('f24-kpi-saldo').textContent = formatEuro(sumSaldo);
  if ($('f24-kpi-count')) $('f24-kpi-count').textContent = filtered.length;
  if ($('f24-view-counter')) $('f24-view-counter').textContent = `Numero versamenti estratti: ${filtered.length}`;

  // 5. Rendering della tabella portale AdE
  if (!filtered.length) {
    container.innerHTML = `
      <div style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:26px 20px;text-align:center;margin-top:10px">
        <div style="font-size:32px;margin-bottom:8px">💳</div>
        <h4 style="margin:0 0 6px;color:#1e293b">Nessun versamento F24 registrato in archivio per il ${activeF24Year}</h4>
        <p class="muted" style="margin:0 0 16px;font-size:13px">Puoi consultare direttamente il cassetto fiscale dell’Agenzia delle Entrate per recuperare le quietanze ufficiali dell'anno selezionato.</p>
        <button type="button" id="f24-inline-search-btn" class="requires-entratel" style="padding:8px 18px;font-size:13px;display:inline-flex;align-items:center;gap:6px" ${!connected ? 'disabled' : ''}>
          🔍 Consulta Portale AdE per il ${activeF24Year}
        </button>
      </div>
    `;
    const inBtn = $('f24-inline-search-btn');
    if (inBtn) inBtn.addEventListener('click', triggerAdEF24Query);
    return;
  }

  const table = document.createElement('table');
  table.style.fontSize = '13px';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:130px">Data versamento</th>
        <th style="width:120px;text-align:center">Numero modelli F24</th>
        <th style="width:140px;text-align:right">Saldo (€)</th>
        <th>Protocollo telematico</th>
        <th style="text-align:center">Quadratura Contabile</th>
        <th style="text-align:right;min-width:180px">Quietanza / Dettaglio</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  for (const m of filtered) {
    const isExpanded = f24ExpandedRows.has(m.protocol);
    const mainRow = document.createElement('tr');
    mainRow.style.cursor = 'pointer';
    mainRow.className = isExpanded ? 'f24-row-selected' : '';

    const balVal = typeof m.balance === 'number' ? m.balance : parseEuro(m.balance);
    const balColor = balVal < 0 ? '#16a34a' : '#0284c7';

    // Badge Quadratura Contabile
    let quadBadge = '';
    const hasTributi = m.tributi && m.tributi.length > 0;
    if (hasTributi) {
      const calcSaldo = roundNum(m.debito - m.credito);
      const isQuad = Math.abs(calcSaldo - roundNum(balVal)) < 0.02;
      if (isQuad) {
        quadBadge = `<span class="badge" style="background:#dcfce7;color:#15803d;font-weight:700;padding:3px 8px;border-radius:4px" title="Quadratura perfetta: somma debiti - somma crediti = saldo quietanza">✓ Quadrato al centesimo</span>`;
      } else {
        quadBadge = `<span class="badge" style="background:#fef3c7;color:#b45309;font-weight:700;padding:3px 8px;border-radius:4px" title="Differenza: ${calcSaldo} vs ${balVal}">⚠️ Da verificare</span>`;
      }
    } else if (m.docId) {
      quadBadge = `<span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:600;padding:3px 8px;border-radius:4px">✓ Archiviata</span>`;
    } else {
      quadBadge = `<span class="badge" style="background:#f1f5f9;color:#64748b;padding:3px 8px;border-radius:4px">Portale AdE</span>`;
    }

    // Azioni riga
    let actionHtml = '';
    if (m.docId) {
      actionHtml = `
        <div style="display:inline-flex;gap:6px;align-items:center;justify-content:flex-end">
          <button type="button" class="f24-toggle-btn secondary" data-proto="${escapeHtml(m.protocol)}" style="padding:3px 8px;font-size:11px">
            ${isExpanded ? '▲ Chiudi' : '▼ Dettagli'}
          </button>
          <a href="${m.viewUrl}" target="_blank" class="button" style="background:#0284c7;color:#fff;padding:3px 8px;font-size:11px;border-radius:4px;text-decoration:none;display:inline-flex;align-items:center;gap:3px">
            👁️ PDF
          </a>
        </div>
      `;
    } else if (m.downloadable || m.protocol) {
      actionHtml = `
        <button type="button" class="secondary f24-row-dl-btn" data-proto="${escapeHtml(m.protocol)}" data-year="${activeF24Year}" style="padding:4px 10px;font-size:12px">
          📥 Scarica Quietanza
        </button>
      `;
    } else {
      actionHtml = `<span class="muted" style="font-size:12px">—</span>`;
    }

    mainRow.innerHTML = `
      <td><strong>${escapeHtml(m.date || '—')}</strong></td>
      <td style="text-align:center"><span class="badge" style="background:#f1f5f9;color:#334155;font-weight:600;padding:2px 8px;border-radius:4px">1</span></td>
      <td style="text-align:right"><strong style="color:${balColor};font-size:14px">${formatEuro(balVal)}</strong></td>
      <td><code>${escapeHtml(m.protocol || '—')}</code></td>
      <td style="text-align:center">${quadBadge}</td>
      <td style="text-align:right">${actionHtml}</td>
    `;

    // Click sulla riga per espandere/collassare se abbiamo dettagli o doc archiviato
    mainRow.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('.f24-row-dl-btn')) return;
      if (f24ExpandedRows.has(m.protocol)) {
        f24ExpandedRows.delete(m.protocol);
      } else {
        f24ExpandedRows.add(m.protocol);
      }
      renderF24AnnualView();
    });

    const dlBtn = mainRow.querySelector('.f24-row-dl-btn');
    if (dlBtn) {
      dlBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        dlBtn.disabled = true;
        dlBtn.textContent = '⏳ Scarico…';
        try {
          await performEntratelOp('f24-download', {
            studio: getActiveStudio(),
            client: selectedClient.taxCode,
            year: activeF24Year,
            protocol: m.protocol
          }, result => {
            f24ExpandedRows.add(m.protocol);
            loadF24Analysis(selectedClient.taxCode);
            loadClientArchive(selectedClient.taxCode);
          });
        } catch (err) {
          alert('Errore download quietanza F24: ' + err.message);
          dlBtn.disabled = false;
          dlBtn.textContent = '📥 Scarica Quietanza';
        }
      });
    }

    tbody.append(mainRow);

    // Riga Espansa Dettaglio Tributario & Quadratura
    if (isExpanded) {
      const detailRow = document.createElement('tr');
      detailRow.className = 'f24-detail-row';
      const detailTd = document.createElement('td');
      detailTd.colSpan = 6;
      detailTd.style.background = '#f8fafc';
      detailTd.style.padding = '14px 18px';
      detailTd.style.borderTop = 'none';

      let innerHtml = '';

      if (hasTributi) {
        const deb = m.debito || 0;
        const cred = m.credito || 0;
        const calcSaldo = roundNum(deb - cred);
        const isQuad = Math.abs(calcSaldo - roundNum(balVal)) < 0.02;

        innerHtml += `
          <div style="background:${isQuad ? '#ecfdf5' : '#fffbeb'};border:1px solid ${isQuad ? '#6ee7b7' : '#fde68a'};border-radius:6px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <span style="font-weight:700;color:${isQuad ? '#065f46' : '#92400e'};font-size:13px">
                ${isQuad ? '✓ Quadratura Contabile Verificata al Centesimo:' : '⚠️ Verifica Quadratura Saldo:'}
              </span>
              <span style="color:${isQuad ? '#047857' : '#b45309'};font-size:13px;margin-left:6px">
                Debiti: <strong>${formatEuro(deb)}</strong> − Crediti Compensati: <strong>${formatEuro(cred)}</strong> = Saldo Quietanza: <strong>${formatEuro(balVal)}</strong>
              </span>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="font-size:12px;color:#64748b">Protocollo: <code>${escapeHtml(m.protocol)}</code></span>
              ${m.viewUrl ? `<a href="${m.viewUrl}" target="_blank" class="button" style="background:#0284c7;color:#fff;padding:3px 10px;font-size:12px;border-radius:4px;text-decoration:none">👁️ Apri Quietanza Originale (PDF)</a>` : ''}
            </div>
          </div>

          <table style="width:100%;font-size:12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:6px 10px">Sezione / Ente</th>
                <th style="padding:6px 10px">Codice Tributo</th>
                <th style="padding:6px 10px">Descrizione Tributo</th>
                <th style="padding:6px 10px">Anno / Rateazione</th>
                <th style="padding:6px 10px;text-align:right">A Debito (€)</th>
                <th style="padding:6px 10px;text-align:right">A Credito (€)</th>
                <th style="padding:6px 10px;text-align:right">Saldo Rigo (€)</th>
              </tr>
            </thead>
            <tbody>
        `;

        for (const t of m.tributi) {
          const s = t.sezione || 'Erario';
          let badgeStyle = 'background:#e0f2fe;color:#0369a1';
          if (s === 'INPS') badgeStyle = 'background:#ffedd5;color:#c2410c';
          else if (s === 'Regioni') badgeStyle = 'background:#dcfce7;color:#15803d';
          else if (s.includes('IMU') || s.includes('Locali')) badgeStyle = 'background:#f3e8ff;color:#7e22ce';
          else if (s.includes('INAIL')) badgeStyle = 'background:#f1f5f9;color:#475569';

          const desc = getTributoDescription(t.codice);
          const rigoSaldo = (t.debito || 0) - (t.credito || 0);

          innerHtml += `
            <tr style="border-top:1px solid #f1f5f9">
              <td style="padding:6px 10px"><span class="badge" style="${badgeStyle};padding:2px 6px;font-size:10px;font-weight:600;border-radius:4px">${escapeHtml(s)}</span></td>
              <td style="padding:6px 10px"><code style="font-weight:700;font-size:12px">${escapeHtml(t.codice)}</code></td>
              <td style="padding:6px 10px;color:#334155">${escapeHtml(desc || '—')}</td>
              <td style="padding:6px 10px">${escapeHtml(t.anno || '')}${t.rateazione ? ` <small class="muted">(${escapeHtml(t.rateazione)})</small>` : ''}</td>
              <td style="padding:6px 10px;text-align:right;font-weight:600;color:${t.debito > 0 ? '#dc2626' : '#64748b'}">${t.debito > 0 ? formatEuro(t.debito) : '—'}</td>
              <td style="padding:6px 10px;text-align:right;font-weight:600;color:${t.credito > 0 ? '#16a34a' : '#64748b'}">${t.credito > 0 ? formatEuro(t.credito) : '—'}</td>
              <td style="padding:6px 10px;text-align:right;font-weight:700;color:${rigoSaldo < 0 ? '#16a34a' : '#0284c7'}">${formatEuro(rigoSaldo)}</td>
            </tr>
          `;
        }

        innerHtml += `
            </tbody>
          </table>
        `;
      } else {
        innerHtml += `
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <div>
              <strong>Quietanza acquisita dall’Agenzia delle Entrate</strong><br>
              <span class="muted" style="font-size:12px">Protocollo: <code>${escapeHtml(m.protocol)}</code> | Data versamento: ${escapeHtml(m.date || '—')} | Saldo: ${formatEuro(balVal)}</span>
            </div>
            ${m.docId ? `<a href="${m.viewUrl}" target="_blank" class="button" style="background:#0284c7;color:#fff;padding:5px 12px;font-size:12px;border-radius:4px;text-decoration:none">👁️ Apri Quietanza Originale</a>` : ''}
          </div>
        `;
      }

      detailTd.innerHTML = innerHtml;
      detailRow.append(detailTd);
      tbody.append(detailRow);
    }
  }

  container.replaceChildren(table);
}

function roundNum(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// -------------------------------------------------------------
// VISTA 2: RICERCHE TRIBUTI F24 (Ric=F24Sel) - Tutti gli anni
// -------------------------------------------------------------
function renderF24TributiSelView() {
  const container = $('f24-tributisel-results');
  if (!container) return;

  if (!selectedClient) {
    container.innerHTML = `<p class="muted" style="padding:16px;text-align:center">Seleziona prima un cliente dal menu laterale.</p>`;
    return;
  }

  const query = ($('f24-tributisel-input')?.value || '').trim().toLowerCase();
  const ente = $('f24-tributisel-ente')?.value || 'all';

  const allTributi = f24AnalysisData.tributi || [];
  const filtered = allTributi.filter(t => {
    if (query) {
      const c = (t.codice || '').toLowerCase();
      const desc = (getTributoDescription(t.codice) || '').toLowerCase();
      if (!c.includes(query) && !desc.includes(query)) return false;
    }
    if (ente !== 'all') {
      const s = (t.sezione || '').toLowerCase();
      if (!s.includes(ente.toLowerCase())) return false;
    }
    return true;
  });

  // KPI per il tributo ricercato
  const totDebito = filtered.reduce((acc, t) => acc + (t.debito || 0), 0);
  const totCredito = filtered.reduce((acc, t) => acc + (t.credito || 0), 0);
  const saldoNetto = totDebito - totCredito;

  let summaryKpi = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:14px">
      <div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid #ef4444;border-radius:6px;padding:8px 12px">
        <small style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase">Totale Debiti Tributo</small>
        <div style="font-size:16px;font-weight:700;color:#dc2626">${formatEuro(totDebito)}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid #10b981;border-radius:6px;padding:8px 12px">
        <small style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase">Totale Crediti Compensati</small>
        <div style="font-size:16px;font-weight:700;color:#16a34a">${formatEuro(totCredito)}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid #0284c7;border-radius:6px;padding:8px 12px">
        <small style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase">Saldo Netto Versato</small>
        <div style="font-size:16px;font-weight:700;color:#0284c7">${formatEuro(saldoNetto)}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid #6366f1;border-radius:6px;padding:8px 12px">
        <small style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase">Occorrenze / Versamenti</small>
        <div style="font-size:16px;font-weight:700;color:#4f46e5">${filtered.length}</div>
      </div>
    </div>
  `;

  if (!filtered.length) {
    container.innerHTML = summaryKpi + `
      <div class="banner" style="background:#f8fafc;color:#475569;margin-top:8px">
        Nessun movimento F24 trovato per il tributo "${escapeHtml(query || 'tutti')}".
      </div>
    `;
    return;
  }

  // Ordinamento per data decrescente
  filtered.sort((a, b) => {
    const da = parseItalianDate(a.date) || new Date(0);
    const db = parseItalianDate(b.date) || new Date(0);
    return db - da;
  });

  const table = document.createElement('table');
  table.style.fontSize = '13px';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Data Versamento</th>
        <th>Anno Rif.</th>
        <th>Sezione / Ente</th>
        <th>Codice Tributo</th>
        <th>Descrizione</th>
        <th style="text-align:right">A Debito (€)</th>
        <th style="text-align:right">A Credito (€)</th>
        <th style="text-align:right">Saldo Rigo (€)</th>
        <th>Protocollo F24</th>
        <th style="text-align:right">Quietanza</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  for (const t of filtered) {
    const row = document.createElement('tr');
    const s = t.sezione || 'Erario';
    let badgeStyle = 'background:#e0f2fe;color:#0369a1';
    if (s === 'INPS') badgeStyle = 'background:#ffedd5;color:#c2410c';
    else if (s === 'Regioni') badgeStyle = 'background:#dcfce7;color:#15803d';
    else if (s.includes('IMU') || s.includes('Locali')) badgeStyle = 'background:#f3e8ff;color:#7e22ce';
    else if (s.includes('INAIL')) badgeStyle = 'background:#f1f5f9;color:#475569';

    const desc = getTributoDescription(t.codice);
    const rigoSaldo = (t.debito || 0) - (t.credito || 0);

    row.innerHTML = `
      <td style="white-space:nowrap"><strong>${escapeHtml(t.date || '—')}</strong></td>
      <td style="text-align:center">${escapeHtml(t.anno || '')}${t.rateazione ? ` <small class="muted">(${escapeHtml(t.rateazione)})</small>` : ''}</td>
      <td><span class="badge" style="${badgeStyle};padding:2px 6px;font-size:11px;font-weight:600;border-radius:4px">${escapeHtml(s)}</span></td>
      <td><code style="font-weight:700;font-size:13px">${escapeHtml(t.codice)}</code></td>
      <td style="max-width:240px;color:#334155">${escapeHtml(desc || '—')}</td>
      <td style="text-align:right;font-weight:600;color:${t.debito > 0 ? '#dc2626' : '#64748b'}">${t.debito > 0 ? formatEuro(t.debito) : '—'}</td>
      <td style="text-align:right;font-weight:600;color:${t.credito > 0 ? '#16a34a' : '#64748b'}">${t.credito > 0 ? formatEuro(t.credito) : '—'}</td>
      <td style="text-align:right;font-weight:700;color:${rigoSaldo < 0 ? '#16a34a' : '#0284c7'}">${formatEuro(rigoSaldo)}</td>
      <td><code>${escapeHtml(t.protocol || '—')}</code></td>
      <td style="text-align:right">
        ${t.viewUrl ? `<a href="${t.viewUrl}" target="_blank" class="button" style="background:#0284c7;color:#fff;padding:3px 8px;font-size:11px;border-radius:4px;text-decoration:none">👁️ Quietanza</a>` : '—'}
      </td>
    `;
    tbody.append(row);
  }

  container.innerHTML = summaryKpi;
  container.append(table);
}

// -------------------------------------------------------------
// VISTA 3: RICERCA PER QUIETANZA / PROTOCOLLO (Ric=QUIESel)
// -------------------------------------------------------------
function renderF24QuieSelView() {
  const container = $('f24-quiesel-results');
  if (!container) return;

  if (!selectedClient) {
    container.innerHTML = `<p class="muted" style="padding:16px;text-align:center">Seleziona prima un cliente dal menu laterale.</p>`;
    return;
  }

  const query = ($('f24-quiesel-input')?.value || '').trim();
  if (!query) {
    container.innerHTML = `<p class="muted" style="padding:16px;text-align:center">Inserisci il protocollo telematico (o una data) per rintracciare la quietanza.</p>`;
    return;
  }

  const allModels = f24AnalysisData.models || [];
  const matches = allModels.filter(m => (m.protocol || '').includes(query) || (m.date || '').includes(query));

  if (!matches.length) {
    container.innerHTML = `
      <div class="banner" style="background:#fef2f2;color:#991b1b;margin-top:8px">
        Nessuna quietanza F24 trovata in archivio corrispondente al protocollo o filtro "${escapeHtml(query)}".
      </div>
    `;
    return;
  }

  let html = `<div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">`;
  for (const m of matches) {
    const balVal = typeof m.balance === 'number' ? m.balance : parseEuro(m.balance);
    const hasTr = m.tributi && m.tributi.length > 0;
    const isQuad = hasTr && Math.abs(roundNum((m.debito || 0) - (m.credito || 0)) - roundNum(balVal)) < 0.02;

    html += `
      <div style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h4 style="margin:0 0 4px">Quietanza F24 - Protocollo <code>${escapeHtml(m.protocol)}</code></h4>
            <span class="muted" style="font-size:12px">Data versamento: <strong>${escapeHtml(m.date || '—')}</strong> | Saldo: <strong>${formatEuro(balVal)}</strong></span>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${isQuad ? '<span class="badge" style="background:#dcfce7;color:#15803d;font-weight:700;padding:3px 8px;border-radius:4px">✓ Quadrato al centesimo</span>' : ''}
            ${m.viewUrl ? `<a href="${m.viewUrl}" target="_blank" class="button" style="background:#0284c7;color:#fff;padding:5px 12px;font-size:12px;border-radius:4px;text-decoration:none">👁️ Apri Quietanza Originale (PDF)</a>` : ''}
          </div>
        </div>
    `;

    if (hasTr) {
      html += `
        <table style="width:100%;font-size:12px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
          <thead style="background:#f8fafc">
            <tr>
              <th style="padding:6px 10px">Sezione</th>
              <th style="padding:6px 10px">Codice Tributo</th>
              <th style="padding:6px 10px">Descrizione</th>
              <th style="padding:6px 10px">Anno/Rat.</th>
              <th style="padding:6px 10px;text-align:right">Debito (€)</th>
              <th style="padding:6px 10px;text-align:right">Credito (€)</th>
              <th style="padding:6px 10px;text-align:right">Saldo Rigo (€)</th>
            </tr>
          </thead>
          <tbody>
      `;
      for (const t of m.tributi) {
        html += `
          <tr style="border-top:1px solid #f1f5f9">
            <td style="padding:6px 10px">${escapeHtml(t.sezione || 'Erario')}</td>
            <td style="padding:6px 10px"><code>${escapeHtml(t.codice)}</code></td>
            <td style="padding:6px 10px">${escapeHtml(getTributoDescription(t.codice) || '—')}</td>
            <td style="padding:6px 10px">${escapeHtml(t.anno || '')}</td>
            <td style="padding:6px 10px;text-align:right">${t.debito > 0 ? formatEuro(t.debito) : '—'}</td>
            <td style="padding:6px 10px;text-align:right">${t.credito > 0 ? formatEuro(t.credito) : '—'}</td>
            <td style="padding:6px 10px;text-align:right"><strong>${formatEuro((t.debito || 0) - (t.credito || 0))}</strong></td>
          </tr>
        `;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  container.innerHTML = html;
}

// -------------------------------------------------------------
// EVENT HANDLERS & INIZIALIZZAZIONE F24
// -------------------------------------------------------------
async function triggerAdEF24Query() {
  if (!selectedClient) { alert('Seleziona prima un cliente.'); return; }
  if (!connected) { alert('Effettua prima l’accesso ad Entratel.'); return; }

  const f24Btn = $('cassetto-f24-btn');
  if (f24Btn) f24Btn.disabled = true;

  const container = $('cassetto-f24-results');
  container.innerHTML = `<p class="banner" data-state="pending">Consultazione versamenti F24 anno ${activeF24Year} in corso sul portale dell’Agenzia delle Entrate…</p>`;

  try {
    await performEntratelOp('f24-list', {
      studio: getActiveStudio(),
      client: selectedClient.taxCode,
      year: activeF24Year
    }, result => {
      f24LivePortalRecordsByYear[activeF24Year] = result.records || [];
      renderF24AnnualView();
    });
  } catch (e) {
    container.innerHTML = `<p class="banner" data-state="error">Errore recupero versamenti dal portale AdE: ${escapeHtml(e.message)}</p>`;
  } finally {
    if (f24Btn) f24Btn.disabled = !connected || busy;
  }
}

// Setup Sottomenu F24 stile Cassetto Fiscale
function initF24Subnav() {
  const btnModels = $('f24-nav-models');
  const btnTributi = $('f24-nav-tributisel');
  const btnQuie = $('f24-nav-quiesel');

  const secModels = $('f24-section-models');
  const secTributi = $('f24-section-tributisel');
  const secQuie = $('f24-section-quiesel');

  function activate(tab) {
    f24SubTab = tab;
    [btnModels, btnTributi, btnQuie].forEach(b => b?.classList.remove('active'));
    [secModels, secTributi, secQuie].forEach(s => { if (s) s.style.display = 'none'; });

    if (tab === 'models') {
      btnModels?.classList.add('active');
      if (secModels) secModels.style.display = 'block';
      renderF24AnnualView();
    } else if (tab === 'tributisel') {
      btnTributi?.classList.add('active');
      if (secTributi) secTributi.style.display = 'block';
      renderF24TributiSelView();
    } else if (tab === 'quiesel') {
      btnQuie?.classList.add('active');
      if (secQuie) secQuie.style.display = 'block';
      renderF24QuieSelView();
    }
  }

  btnModels?.addEventListener('click', () => activate('models'));
  btnTributi?.addEventListener('click', () => activate('tributisel'));
  btnQuie?.addEventListener('click', () => activate('quiesel'));
}

// Setup bottoni selettore Annualità
function initF24YearButtons() {
  document.querySelectorAll('.f24-year-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchF24Year(btn.dataset.year);
    });
  });
}

// Event listeners filtri temporali sui versamenti acquisiti
['f24-filter-from', 'f24-filter-to', 'f24-filter-ente', 'f24-filter-tributo'].forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener('input', renderF24AnnualView);
    el.addEventListener('change', renderF24AnnualView);
  }
});

if ($('f24-reset-filters-btn')) {
  $('f24-reset-filters-btn').addEventListener('click', () => {
    if ($('f24-filter-from')) $('f24-filter-from').value = '';
    if ($('f24-filter-to')) $('f24-filter-to').value = '';
    if ($('f24-filter-ente')) $('f24-filter-ente').value = 'all';
    if ($('f24-filter-tributo')) $('f24-filter-tributo').value = '';
    renderF24AnnualView();
  });
}

// Event listeners Ricerche tributi F24 (Ric=F24Sel)
if ($('f24-tributisel-input')) {
  $('f24-tributisel-input').addEventListener('input', renderF24TributiSelView);
}
if ($('f24-tributisel-ente')) {
  $('f24-tributisel-ente').addEventListener('change', renderF24TributiSelView);
}
document.querySelectorAll('.f24-chip-suggest').forEach(chip => {
  chip.addEventListener('click', () => {
    const trib = chip.dataset.trib;
    const inp = $('f24-tributisel-input');
    if (inp) {
      inp.value = trib;
      renderF24TributiSelView();
    }
  });
});

// Event listeners Ricerca Quietanza (Ric=QUIESel)
if ($('f24-quiesel-btn')) {
  $('f24-quiesel-btn').addEventListener('click', renderF24QuieSelView);
}
if ($('f24-quiesel-input')) {
  $('f24-quiesel-input').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') renderF24QuieSelView();
  });
}

// Pulsante Consulta Portale AdE
if ($('cassetto-f24-btn')) {
  $('cassetto-f24-btn').addEventListener('click', triggerAdEF24Query);
}

// Ricarica e Esporta CSV
if ($('f24-reload-analysis-btn')) {
  $('f24-reload-analysis-btn').addEventListener('click', () => {
    if (selectedClient) loadF24Analysis(selectedClient.taxCode);
  });
}

function exportF24ToCsv() {
  if (!selectedClient) { alert('Nessun cliente selezionato.'); return; }

  let rowsToExport = [];
  let filename = '';

  if (f24SubTab === 'models') {
    filename = `F24_${selectedClient.taxCode}_Anno_${activeF24Year}.csv`;
    const archived = (f24AnalysisData.models || []).filter(m => {
      if (m.year && String(m.year) === activeF24Year) return true;
      const d = parseItalianDate(m.date);
      return d && String(d.getFullYear()) === activeF24Year;
    });

    for (const m of archived) {
      if (m.tributi && m.tributi.length > 0) {
        for (const t of m.tributi) {
          rowsToExport.push({
            data: m.date || '',
            anno: t.anno || activeF24Year,
            sezione: t.sezione || 'Erario',
            codice: t.codice || '',
            descrizione: getTributoDescription(t.codice) || '',
            rateazione: t.rateazione || '',
            debito: t.debito || 0,
            credito: t.credito || 0,
            saldo: (t.debito || 0) - (t.credito || 0),
            protocollo: m.protocol || ''
          });
        }
      } else {
        rowsToExport.push({
          data: m.date || '',
          anno: activeF24Year,
          sezione: 'Totale F24',
          codice: '—',
          descrizione: 'Modello F24 complessivo',
          rateazione: '',
          debito: typeof m.balance === 'number' ? m.balance : parseEuro(m.balance),
          credito: 0,
          saldo: typeof m.balance === 'number' ? m.balance : parseEuro(m.balance),
          protocollo: m.protocol || ''
        });
      }
    }
  } else {
    filename = `F24_Ricerche_Tributi_${selectedClient.taxCode}.csv`;
    const allTributi = f24AnalysisData.tributi || [];
    const query = ($('f24-tributisel-input')?.value || '').trim().toLowerCase();
    const ente = $('f24-tributisel-ente')?.value || 'all';

    const filtered = allTributi.filter(t => {
      if (query) {
        const c = (t.codice || '').toLowerCase();
        const desc = (getTributoDescription(t.codice) || '').toLowerCase();
        if (!c.includes(query) && !desc.includes(query)) return false;
      }
      if (ente !== 'all') {
        const s = (t.sezione || '').toLowerCase();
        if (!s.includes(ente.toLowerCase())) return false;
      }
      return true;
    });

    for (const t of filtered) {
      rowsToExport.push({
        data: t.date || '',
        anno: t.anno || '',
        sezione: t.sezione || 'Erario',
        codice: t.codice || '',
        descrizione: getTributoDescription(t.codice) || '',
        rateazione: t.rateazione || '',
        debito: t.debito || 0,
        credito: t.credito || 0,
        saldo: (t.debito || 0) - (t.credito || 0),
        protocollo: t.protocol || ''
      });
    }
  }

  if (!rowsToExport.length) {
    alert('Nessun dato da esportare per la selezione corrente.');
    return;
  }

  let csv = '\uFEFF';
  csv += 'Cliente;Codice Fiscale;Data Versamento;Anno Rif;Sezione/Ente;Codice Tributo;Descrizione;Rateazione;Debito (€);Credito (€);Saldo Rigo (€);Protocollo F24\r\n';

  for (const r of rowsToExport) {
    const desc = (r.descrizione || '').replace(/"/g, '""');
    const cols = [
      `"${selectedClient.name}"`,
      `"${selectedClient.taxCode}"`,
      `"${r.data}"`,
      `"${r.anno}"`,
      `"${r.sezione}"`,
      `"${r.codice}"`,
      `"${desc}"`,
      `"${r.rateazione}"`,
      String(r.debito).replace('.', ','),
      String(r.credito).replace('.', ','),
      String(r.saldo).replace('.', ','),
      `"${r.protocollo}"`
    ];
    csv += cols.join(';') + '\r\n';
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

if ($('f24-export-csv-btn')) {
  $('f24-export-csv-btn').addEventListener('click', exportF24ToCsv);
}

// Inizializza sottomenu e pulsanti anno
initF24Subnav();
initF24YearButtons();

// -------------------------------------------------------------
// 4. FATTURE & CORRISPETTIVI (SDI)
// -------------------------------------------------------------

async function openInvoicesSection(direction) {
  if (!selectedClient) { alert('Seleziona prima un cliente.'); return; }
  if (!connected) { alert('Effettua prima l’accesso ad Entratel.'); return; }

  const statusBox = $('sdi-status');
  statusBox.className = 'banner';
  statusBox.dataset.state = 'pending';
  statusBox.textContent = `Instradamento delega per ${selectedClient.name} e apertura fatture ${direction} in corso…`;

  try {
    await performEntratelOp('invoices-open', {
      studio: getActiveStudio(),
      client: selectedClient.taxCode,
      direction: direction
    }, result => {
      statusBox.className = 'banner';
      statusBox.dataset.state = 'ok';
      statusBox.innerHTML = `✓ <strong>Sessione Fatture ${direction === 'ricevute' ? 'Ricevute' : 'Emesse'} pronta!</strong><br>` +
        `Stai operando per conto di <strong>${selectedClient.name}</strong> (CF: ${selectedClient.taxCode}) con delega confermata dallo studio <strong>${getActiveStudio()}</strong>.`;
    });
  } catch (e) {
    statusBox.className = 'banner';
    statusBox.dataset.state = 'error';
    statusBox.textContent = 'Errore apertura fatture: ' + e.message;
  }
}

if ($('sdi-invoices-received-btn')) {
  $('sdi-invoices-received-btn').addEventListener('click', () => openInvoicesSection('ricevute'));
}
if ($('sdi-invoices-issued-btn')) {
  $('sdi-invoices-issued-btn').addEventListener('click', () => openInvoicesSection('emesse'));
}

// -------------------------------------------------------------
// 5. ARCHIVIO DOCUMENTI NEXTCLOUD
// -------------------------------------------------------------

async function loadClientArchive(taxCode) {
  const container = $('client-archive-results');
  if (!container || !taxCode) return;
  container.innerHTML = '<p class="muted">Caricamento documenti archiviati…</p>';
  try {
    const r = await fetch(`/studio-ade-api?op=archive&client=${encodeURIComponent(taxCode)}`, { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json();
    cachedClientDocs = d.documents || [];

    // Aggiorna tabella dichiarazioni se presente per mostrare "✓ In Archivio / 👁️ Apri PDF"
    if (currentDeclarationYears && currentDeclarationYears.length > 0) {
      renderDeclarationTable(currentDeclarationModel, currentDeclarationYears);
    }

    const folderUrl = `/apps/files/?dir=/Studio/AgenziaEntrate/${encodeURIComponent(taxCode)}`;
    const headerHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;background:#f8fafc;padding:10px 14px;border-radius:6px;border:1px solid #e2e8f0;flex-wrap:wrap;gap:8px">
        <div>
          <span style="font-size:13px;color:#475569">Cartella archivio: <code>Studio/AgenziaEntrate/${escapeHtml(taxCode)}/</code></span>
        </div>
        <a href="${folderUrl}" target="_blank" class="button secondary" style="padding:5px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;font-weight:600;text-decoration:none">📁 Sfoglia cartella su Nextcloud</a>
      </div>
    `;

    if (!r.ok || !cachedClientDocs.length) {
      container.innerHTML = headerHtml + '<p class="muted" style="padding:10px 0">Nessun documento ancora acquisito per questo cliente.</p>';
      return;
    }
    const table = document.createElement('table');
    table.innerHTML = `<thead><tr><th>Documento</th><th>Data Acquisizione</th><th style="text-align:right">Azioni</th></tr></thead><tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    for (const doc of cachedClientDocs) {
      const row = document.createElement('tr');
      const title = doc.title || (doc.kind === 'f24' ? `Quietanza F24 (${doc.protocol || ''})` : `Dichiarazione dei redditi ${doc.protocol || ''}`);
      const date = doc.acquiredAt ? new Date(doc.acquiredAt).toLocaleString('it-IT') : '—';
      const viewUrl = `/studio-ade-api?op=document&client=${encodeURIComponent(taxCode)}&id=${encodeURIComponent(doc.id)}`;
      const downUrl = `${viewUrl}&download=1`;
      row.innerHTML = `<td><strong>${escapeHtml(title)}</strong></td><td>${date}</td><td style="text-align:right">
        <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
          <a href="${viewUrl}" target="_blank" class="button" style="background:#0284c7;color:#fff;padding:4px 10px;font-size:12px;display:inline-flex;align-items:center;gap:4px;font-weight:600;text-decoration:none">👁️ Apri PDF</a>
          <a href="${downUrl}" class="button secondary" style="padding:4px 8px;font-size:12px;text-decoration:none" title="Scarica file sul computer">💾</a>
        </div>
      </td>`;
      tbody.append(row);
    }
    const wrapDiv = document.createElement('div');
    wrapDiv.innerHTML = headerHtml;
    wrapDiv.append(table);
    container.replaceChildren(wrapDiv);
  } catch (e) {
    container.innerHTML = `<p class="banner" data-state="error">Impossibile consultare l’archivio: ${escapeHtml(e.message)}</p>`;
  }
}

// -------------------------------------------------------------
// 6. VERIFICHE ANAGRAFICHE UFFICIALI (API)
// -------------------------------------------------------------

async function verifyIdentity(kind, value) {
  const resEl = $('verify-result');
  if (!value) { alert('Inserisci il codice da verificare.'); return; }
  resEl.className = 'banner';
  resEl.dataset.state = 'pending';
  resEl.textContent = 'Interrogazione API Agenzia delle Entrate in corso…';
  try {
    const res = await api({ op: 'verify', kind, value });
    resEl.className = 'banner';
    resEl.dataset.state = 'ok';
    const r = res.result || {};
    let html = `<strong>Riscontro ufficiale Agenzia delle Entrate:</strong><br>`;
    if (kind === 'cf') {
      html += `Codice fiscale: <strong>${res.identifier}</strong> — Stato: <strong>${r.valido ? 'VALIDO' : 'NON VALIDO'}</strong><br>${r.messaggio || ''}`;
    } else {
      html += `Partita IVA: <strong>${r.partitaIva || res.identifier}</strong> — Stato: <strong>${r.valida ? 'ATTIVA / VALIDA' : 'CESSATA O NON VALIDA'}</strong><br>`;
      if (r.denominazione) html += `Denominazione: <strong>${r.denominazione}</strong><br>`;
      if (r.dataInizioAttivita) html += `Inizio attività: ${r.dataInizioAttivita}<br>`;
      if (r.dataCessazioneAttivita) html += `Cessazione: ${r.dataCessazioneAttivita}<br>`;
    }
    resEl.innerHTML = html;
  } catch (e) {
    resEl.className = 'banner';
    resEl.dataset.state = 'error';
    resEl.textContent = 'Verifica fallita: ' + e.message;
  }
}

if ($('verify-cf-btn')) {
  $('verify-cf-btn').addEventListener('click', () => {
    verifyIdentity('cf', $('verify-cf-input').value.trim());
  });
}
if ($('verify-piva-btn')) {
  $('verify-piva-btn').addEventListener('click', () => {
    verifyIdentity('piva', $('verify-piva-input').value.trim());
  });
}

// -------------------------------------------------------------
// 9. REGISTRO AUDIT GDPR
// -------------------------------------------------------------

async function loadAuditLog() {
  const tbody = $('audit-tbody');
  if (!tbody) return;
  const filterClient = $('audit-filter-client')?.checked;
  const cf = filterClient && selectedClient ? (selectedClient.taxCode || selectedClient.vatNumber) : '';
  const exportBtn = $('audit-export-btn');
  if (exportBtn) {
    exportBtn.href = '/studio-ade-api?op=audit-log&format=csv' + (cf ? '&client=' + encodeURIComponent(cf) : '');
  }
  const badge = $('audit-client-badge');
  if (badge) {
    badge.textContent = cf ? `Filtro: ${selectedClient.name} (${cf})` : '';
  }

  tbody.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#64748b">Caricamento registro di audit in corso…</td></tr>';

  try {
    const url = '/studio-ade-api?op=audit-log' + (cf ? '&client=' + encodeURIComponent(cf) : '');
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json();
    if (!r.ok || !Array.isArray(d.logs) || !d.logs.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#64748b">Nessuna voce presente nel registro per i criteri selezionati.</td></tr>';
      return;
    }
    tbody.replaceChildren();
    for (const log of d.logs) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #e2e8f0';

      const tdTime = document.createElement('td');
      tdTime.style.padding = '8px 10px';
      tdTime.textContent = log.timestamp || '-';

      const tdOp = document.createElement('td');
      tdOp.style.padding = '8px 10px';
      tdOp.innerHTML = `<strong>${log.operator || '-'}</strong>`;

      const tdClient = document.createElement('td');
      tdClient.style.padding = '8px 10px';
      tdClient.innerHTML = log.client ? `<code>${log.client}</code>` : '<span style="color:#94a3b8">-</span>';

      const tdAction = document.createElement('td');
      tdAction.style.padding = '8px 10px';
      const actionLabels = {
        'f24-list': 'Consultazione F24',
        'f24-download': 'Download Quietanza F24',
        'declaration-download': 'Download Dichiarazione',
        'invoices-open': 'Apertura Fatture SDI',
        'cu-generate-submit': 'Invio Richiesta CU',
        'cu-esito': 'Verifica Esito CU',
        'cu-download': 'Download File CU',
        'cu-auto-poll': 'Polling Automatico CU',
        'login': 'Login Entratel',
        'circuit-reset': 'Reset Salvavita PIN',
        'test-audit': 'Test Inizializzazione'
      };
      tdAction.textContent = actionLabels[log.operation] || log.operation;

      const tdDetails = document.createElement('td');
      tdDetails.style.padding = '8px 10px';
      tdDetails.style.color = '#475569';
      tdDetails.textContent = log.details || '-';

      const tdStatus = document.createElement('td');
      tdStatus.style.padding = '8px 10px';
      const isOk = log.status === 'ok';
      tdStatus.innerHTML = `<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-weight:600;font-size:11px;background:${isOk ? '#dcfce7' : '#fee2e2'};color:${isOk ? '#15803d' : '#b91c1c'}">${isOk ? '✓ OK' : '✗ Errore'}</span>`;

      const tdIp = document.createElement('td');
      tdIp.style.padding = '8px 10px';
      tdIp.style.fontFamily = 'monospace';
      tdIp.textContent = log.ip || '-';

      const tdHash = document.createElement('td');
      tdHash.style.padding = '8px 10px';
      tdHash.innerHTML = `<code title="Hash SHA-256 concatenato: ${log.hash}" style="font-size:11px;cursor:help;color:#0284c7">${(log.hash || '').slice(0, 10)}…</code>`;

      tr.append(tdTime, tdOp, tdClient, tdAction, tdDetails, tdStatus, tdIp, tdHash);
      tbody.append(tr);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;text-align:center;color:#ef4444">Errore nel caricamento del registro: ${e.message}</td></tr>`;
  }
}

if ($('audit-refresh-btn')) {
  $('audit-refresh-btn').addEventListener('click', loadAuditLog);
}
if ($('audit-filter-client')) {
  $('audit-filter-client').addEventListener('change', loadAuditLog);
}

// -------------------------------------------------------------
// BOOTSTRAP INIZIALE
// -------------------------------------------------------------

async function init() {
  try {
    const r = await fetch('/studio-ade-api?op=bootstrap', { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Accesso Nextcloud richiesto.');
    csrf = d.requesttoken;

    // Check connector state & circuit breaker
    try {
      const state = await api({ op: 'status' });
      connected = Boolean(state.connected);
      pendingJob = state.pending?.[0]?.id || null;
      updateCircuitBreakerUI(Boolean(state.circuitTripped), state.circuitReason);
      updateConnectionStatus(connected ? 'connected' : pendingJob ? 'pending' : 'idle',
        connected ? 'Sessione Entratel attiva.' : pendingJob ? 'Operazione in sospeso: premi Riprendi operazione.' : 'Inserisci le credenziali Entratel per iniziare.');
    } catch {
      updateCircuitBreakerUI(false);
      updateConnectionStatus('idle', 'Connettore pronto per l’accesso Entratel.');
    }

    // Load clients
    const rc = await fetch('/studio-ade-api?op=cu-clients', { credentials: 'same-origin', cache: 'no-store' });
    const dc = await rc.json();
    if (rc.ok && Array.isArray(dc.clients)) {
      allClients = dc.clients;
      renderClientList();
      // Auto-select first client if available
      // Selection is explicit: never start a portal consultation for an arbitrary client.
    }
  } catch (e) {
    console.error('Init error:', e);
  }
}

init();
