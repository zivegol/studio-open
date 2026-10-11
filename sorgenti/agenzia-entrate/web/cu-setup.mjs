const form = document.getElementById('cu-setup');
const out = document.getElementById('cu-setup-result');
const save = document.getElementById('cu-save');
const badge = document.getElementById('cu-badge');
const diagBtn = document.getElementById('cu-test-diag');
const diagOut = document.getElementById('cu-diag-result');
const submitForm = document.getElementById('cu-submit-form');
const submitBtn = document.getElementById('cu-submit-btn');
const submitOut = document.getElementById('cu-submit-result');
const protoInput = document.getElementById('cu-proto-input');
const esitoBtn = document.getElementById('cu-esito-btn');
const historyList = document.getElementById('cu-history-list');

// Direct CU elements
const clientSearch = document.getElementById('cu-client-search');
const selectAllBtn = document.getElementById('cu-select-all');
const deselectAllBtn = document.getElementById('cu-deselect-all');
const clientsContainer = document.getElementById('cu-clients-container');
const selectedCountEl = document.getElementById('cu-selected-count');
const directSubmitBtn = document.getElementById('cu-direct-submit-btn');
const directSubmitResult = document.getElementById('cu-direct-submit-result');

let csrf = '', verified = false, allStudioClients = [];

function renderCerts(certs) {
  const box = document.createElement('div');
  box.style.margin = '8px 0';
  for (const [role, c] of Object.entries(certs)) {
    const p = document.createElement('p');
    p.style.margin = '3px 0';
    p.style.fontSize = '13px';
    const subj = Object.entries(c.subject || {}).map(([k, v]) => `${k}=${v}`).join(' · ');
    p.textContent = (role === 'firma' ? 'Firma: ' : 'Cifra: ') + subj + ' | Scadenza: ' + c.validTo + (c.validNow ? '' : ' — NON VALIDO');
    box.append(p);
  }
  return box;
}

let countdownInterval = null;

function startRateLimitCountdown(seconds, msg) {
  if (!directSubmitBtn || !directSubmitResult) return;
  if (countdownInterval) clearInterval(countdownInterval);
  directSubmitBtn.disabled = true;
  let remaining = seconds;

  const timerP = document.createElement('div');
  timerP.className = 'banner';
  timerP.style.background = '#fef3c7';
  timerP.style.color = '#92400e';
  timerP.style.border = '1px solid #fde68a';
  timerP.id = 'cu-countdown-banner';
  directSubmitResult.replaceChildren(timerP);

  const updateTimer = () => {
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      timerP.className = 'banner';
      timerP.textContent = 'Attesa minima terminata. Il gateway non ha ancora confermato lo sblocco: un nuovo tentativo potrebbe ricevere ancora errore 429. Nessun invio automatico è stato effettuato.';
      updateSelectedCount();
      return;
    }
    const hours = Math.floor(remaining / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    const secs = remaining % 60;
    const timeStr = hours > 0
      ? `${hours}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`
      : `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    timerP.textContent = `Richiesta CU non accettata. ${msg || ''} Attesa minima prima di un eventuale nuovo tentativo: ${timeStr}. La scadenza non garantisce lo sblocco del gateway. Non vengono effettuati tentativi automatici.`;
    directSubmitBtn.textContent = `⏳ Attesa: ${timeStr}`;
    remaining--;
  };

  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

function updateSelectedCount() {
  if (!clientsContainer || !selectedCountEl) return;
  const checked = clientsContainer.querySelectorAll('input[type="checkbox"]:checked');
  const count = checked.length;
  selectedCountEl.textContent = count;
  if (directSubmitBtn) {
    directSubmitBtn.disabled = (count === 0 || countdownInterval !== null);
    directSubmitBtn.textContent = count > 0 ? `🚀 Genera ed invia richiesta CU all'Agenzia (${count})` : `🚀 Genera ed invia richiesta CU all'Agenzia`;
  }
  const downloadRcuBtn = document.getElementById('cu-download-rcu-btn');
  if (downloadRcuBtn) {
    downloadRcuBtn.disabled = (count === 0);
    downloadRcuBtn.textContent = count > 0 ? `💾 Scarica fornitura RCU (${count})` : `💾 Scarica fornitura RCU (.rcu)`;
  }
}

function filterClients() {
  if (!clientsContainer) return;
  const q = (clientSearch ? clientSearch.value : '').toLowerCase().trim();
  const rows = clientsContainer.querySelectorAll('.cu-client-row');
  for (const row of rows) {
    const text = row.dataset.search || '';
    row.style.display = (q === '' || text.includes(q)) ? 'flex' : 'none';
  }
}

async function loadCuClients() {
  if (!clientsContainer) return;
  try {
    const r = await fetch('/studio-ade-api?op=cu-clients', { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json();
    if (!r.ok || !Array.isArray(d.clients) || !d.clients.length) {
      clientsContainer.innerHTML = '<p class="muted" style="padding:12px;text-align:center">Nessun cliente trovato nel dossier dello studio.</p>';
      return;
    }
    allStudioClients = d.clients;
    clientsContainer.replaceChildren();

    for (const c of d.clients) {
      const row = document.createElement('label');
      row.className = 'cu-client-row';
      row.dataset.search = `${c.name} ${c.taxCode} ${c.vatNumber || ''}`.toLowerCase();
      row.dataset.eligible = c.eligibleCu ? '1' : '0';
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#fff;margin-bottom:2px;border-radius:4px;cursor:pointer;';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = c.taxCode;
      cb.style.margin = '0';
      cb.style.cursor = 'pointer';

      if (!c.eligibleCu) {
        cb.disabled = true;
        row.style.opacity = '0.5';
        row.style.cursor = 'not-allowed';
      }

      cb.addEventListener('change', updateSelectedCount);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;';

      const nameSpan = document.createElement('span');
      nameSpan.innerHTML = `<strong>${c.name}</strong> <code style="color:#475569;margin-left:6px">${c.taxCode || c.vatNumber}</code>`;

      const tagSpan = document.createElement('span');
      tagSpan.style.cssText = 'font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600;';
      if (c.type === 'DI') {
        tagSpan.style.background = '#e0f2fe';
        tagSpan.style.color = '#0369a1';
        tagSpan.textContent = 'Ditta Individuale (Ammessa)';
      } else if (c.type === 'PF') {
        tagSpan.style.background = '#dcfce7';
        tagSpan.style.color = '#15803d';
        tagSpan.textContent = 'Persona Fisica (Ammessa)';
      } else {
        tagSpan.style.background = '#f1f5f9';
        tagSpan.style.color = '#64748b';
        tagSpan.textContent = 'Società (Esclusa da CU PF)';
      }

      info.append(nameSpan, tagSpan);
      row.append(cb, info);
      clientsContainer.append(row);
    }
    updateSelectedCount();
  } catch (e) {
    clientsContainer.innerHTML = `<p class="banner" data-state="error" style="margin:4px">Errore nel caricamento clienti: ${e.message}</p>`;
  }
}

if (clientSearch) {
  clientSearch.addEventListener('input', filterClients);
}

if (selectAllBtn) {
  selectAllBtn.addEventListener('click', () => {
    if (!clientsContainer) return;
    const rows = clientsContainer.querySelectorAll('.cu-client-row');
    for (const row of rows) {
      if (row.style.display !== 'none' && row.dataset.eligible === '1') {
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb && !cb.disabled) cb.checked = true;
      }
    }
    updateSelectedCount();
  });
}

if (deselectAllBtn) {
  deselectAllBtn.addEventListener('click', () => {
    if (!clientsContainer) return;
    const cbs = clientsContainer.querySelectorAll('input[type="checkbox"]');
    for (const cb of cbs) cb.checked = false;
    updateSelectedCount();
  });
}

if (directSubmitBtn) {
  directSubmitBtn.addEventListener('click', async () => {
    const checked = clientsContainer.querySelectorAll('input[type="checkbox"]:checked');
    const taxCodes = Array.from(checked).map(cb => cb.value).filter(Boolean);
    if (!taxCodes.length) {
      alert('Seleziona almeno un cliente per procedere.');
      return;
    }

    const confirmMsg = `Stai per generare ed inviare telematicamente all'Agenzia delle Entrate la richiesta CU per ${taxCodes.length} soggetti.\n\n` +
      `ATTENZIONE: L'Agenzia ammette un massimo di 2 richieste giornaliere per intermediario.\n\n` +
      `Vuoi procedere con l'invio immediato?`;
    if (!confirm(confirmMsg)) return;

    directSubmitBtn.disabled = true;
    directSubmitResult.replaceChildren();

    const loading = document.createElement('p');
    loading.className = 'banner';
    loading.textContent = `Generazione tracciato ministeriale RCU26, cifratura Entratel CCF e trasmissione via API a modipa.agenziaentrate.gov.it per ${taxCodes.length} soggetti…`;
    directSubmitResult.append(loading);

    try {
      const r = await fetch('/studio-ade-api?op=cu-generate-submit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', requesttoken: csrf },
        body: JSON.stringify({ taxCodes })
      });
      const d = await r.json();
      directSubmitResult.replaceChildren();

      if (!r.ok) {
        if (d.retryAfter) {
          startRateLimitCountdown(d.retryAfter, d.error);
          return;
        }
        const err = document.createElement('p');
        err.className = 'banner';
        err.dataset.state = 'error';
        err.textContent = (d.error || 'Invio richiesta CU fallito.');
        directSubmitResult.append(err);
        return;
      }

      const ok = document.createElement('div');
      ok.className = 'banner';
      ok.dataset.state = 'ok';
      ok.innerHTML = `✓ <strong>Richiesta CU inviata e presa in carico con successo dall'Agenzia delle Entrate!</strong><br>` +
        `<strong>Protocollo telematico assegnato: ${d.protocollo}</strong><br>` +
        `Soggetti inclusi: ${d.numClients || taxCodes.length} · ${d.messaggio || ''}<br>` +
        `<small style="display:block;margin-top:6px;color:#166534">Il protocollo è stato inserito automaticamente nella sezione sottostante per il controllo esito e scarico dei file.</small>`;
      directSubmitResult.append(ok);

      if (protoInput) protoInput.value = d.protocollo;
      loadHistory();

      // Deselect after successful submission
      const cbs = clientsContainer.querySelectorAll('input[type="checkbox"]');
      for (const cb of cbs) cb.checked = false;
      updateSelectedCount();
    } catch (e) {
      directSubmitResult.textContent = 'Errore di connessione durante l’invio: ' + e.message;
    } finally {
      directSubmitBtn.disabled = false;
    }
  });
}

const downloadRcuBtn = document.getElementById('cu-download-rcu-btn');
if (downloadRcuBtn) {
  downloadRcuBtn.addEventListener('click', async () => {
    const checked = clientsContainer.querySelectorAll('input[type="checkbox"]:checked');
    const taxCodes = Array.from(checked).map(cb => cb.value).filter(Boolean);
    if (!taxCodes.length) {
      alert('Seleziona almeno un cliente per procedere.');
      return;
    }
    try {
      downloadRcuBtn.disabled = true;
      downloadRcuBtn.textContent = 'Generazione fornitura in corso…';
      const r = await fetch('/studio-ade-api?op=cu-generate-rcu', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', requesttoken: csrf },
        body: JSON.stringify({ taxCodes })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Errore nella generazione RCU.');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '00000000000_RCU26.rcu';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Errore generazione RCU: ' + e.message);
    } finally {
      downloadRcuBtn.disabled = false;
      updateSelectedCount();
    }
  });
}

async function loadHistory() {
  if (!historyList) return;
  try {
    const r = await fetch('/studio-ade-api?op=cu-history', { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json();
    if (!r.ok || !Array.isArray(d.requests) || !d.requests.length) {
      historyList.textContent = 'Nessuna richiesta ancora registrata.';
      return;
    }
    historyList.replaceChildren();
    for (const req of d.requests) {
      const card = document.createElement('div');
      card.style.cssText = 'padding:10px 14px;border:1px solid #e2e8f0;border-radius:7px;margin:8px 0;background:#fff;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px';

      const info = document.createElement('div');
      info.innerHTML = `<strong>Protocollo: ${req.protocollo}</strong><br><small style="color:#64748b">File: ${req.fileName || '-'} · Data: ${new Date(req.submittedAt).toLocaleString('it-IT')}</small>`;

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.alignItems = 'center';

      const statusBadge = document.createElement('span');
      statusBadge.style.cssText = 'font-size:12px;padding:3px 9px;border-radius:12px;font-weight:600;';
      if (req.status === 'completata') {
        statusBadge.style.background = '#d1fae5';
        statusBadge.style.color = '#065f46';
        statusBadge.textContent = 'Completata';
      } else {
        statusBadge.style.background = '#fef3c7';
        statusBadge.style.color = '#92400e';
        statusBadge.textContent = 'In elaborazione';
      }
      actions.append(statusBadge);

      if (req.status === 'completata' && (req.hasFiles == 1 || req.hasFiles === true)) {
        const viewReceiptBtn = document.createElement('a');
        viewReceiptBtn.className = 'button secondary';
        viewReceiptBtn.style.cssText = 'padding:6px 12px;font-size:12px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;';
        viewReceiptBtn.textContent = '👁️ Ricevuta PDF';
        viewReceiptBtn.href = `/studio-ade-api?op=cu-download&protocollo=${encodeURIComponent(req.protocollo)}&type=ricevuta`;
        viewReceiptBtn.target = '_blank';
        actions.append(viewReceiptBtn);

        const dlReceiptBtn = document.createElement('a');
        dlReceiptBtn.className = 'button';
        dlReceiptBtn.style.cssText = 'padding:6px 12px;font-size:12px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;';
        dlReceiptBtn.textContent = '📥 Scarica';
        dlReceiptBtn.href = `/studio-ade-api?op=cu-download&protocollo=${encodeURIComponent(req.protocollo)}&type=ricevuta&download=1`;
        actions.append(dlReceiptBtn);
      }

      const checkBtn = document.createElement('button');
      checkBtn.textContent = 'Dettagli esito';
      checkBtn.className = 'secondary';
      checkBtn.style.padding = '6px 12px';
      checkBtn.style.fontSize = '12px';
      checkBtn.addEventListener('click', () => {
        protoInput.value = req.protocollo;
        checkEsito(req.protocollo);
      });
      actions.append(checkBtn);

      card.append(info, actions);
      historyList.append(card);
    }
  } catch {}
}

async function checkEsito(proto) {
  proto = (proto || protoInput.value).trim();
  if (!proto) {
    esitoOut.textContent = 'Inserisci un protocollo valido.';
    return;
  }
  esitoBtn.disabled = true;
  esitoOut.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'banner';
  loading.textContent = 'Interrogazione esito in corso presso l’Agenzia delle Entrate…';
  esitoOut.append(loading);

  try {
    const r = await fetch('/studio-ade-api?op=cu-esito', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', requesttoken: csrf },
      body: JSON.stringify({ protocollo: proto })
    });
    const d = await r.json();
    esitoOut.replaceChildren();

    if (!r.ok) {
      const err = document.createElement('p');
      err.className = 'banner';
      err.dataset.state = 'error';
      err.textContent = (d.error || 'Errore nel recupero esito.') + (d.retryAfter ? ' Riprova tra ' + d.retryAfter + ' secondi.' : '');
      esitoOut.append(err);
      return;
    }

    if (d.status === 'in_elaborazione' || r.status === 202) {
      const p = document.createElement('p');
      p.className = 'banner';
      p.style.background = '#fef3c7';
      p.style.color = '#92400e';
      p.textContent = '⏳ Richiesta presa in carico dall’Agenzia ed in fase di elaborazione (Protocollo: ' + proto + '). Riprova più tardi.';
      esitoOut.append(p);
    } else if (d.status === 'completata' || r.status === 200) {
      const p = document.createElement('p');
      p.className = 'banner';
      const isScarto = d.messaggio && (d.messaggio.toLowerCase().includes('scarto') || d.messaggio.toLowerCase().includes('non elaborabile'));
      p.dataset.state = isScarto ? 'error' : 'ok';
      p.innerHTML = `<strong>Esito Agenzia delle Entrate per protocollo ${proto}:</strong><br>${d.messaggio || 'Elaborazione completata'}`;
      esitoOut.append(p);

      if (d.hasFiles) {
        const fileLinks = document.createElement('div');
        fileLinks.style.cssText = 'display:flex;gap:12px;margin-top:10px;flex-wrap:wrap;';

        const aView = document.createElement('a');
        aView.className = 'button secondary';
        aView.textContent = '👁️ Visualizza Ricevuta PDF';
        aView.href = d.receiptUrl;
        aView.target = '_blank';

        const aRicevuta = document.createElement('a');
        aRicevuta.className = 'button';
        aRicevuta.textContent = '📄 Scarica Ricevuta PDF';
        aRicevuta.href = d.receiptUrl + '&download=1';

        fileLinks.append(aView, aRicevuta);

        if (d.file_cu && d.cuUrl) {
          const aCu = document.createElement('a');
          aCu.className = 'button';
          aCu.textContent = '📦 Scarica File CU (.dat)';
          aCu.href = d.cuUrl + '&download=1';
          fileLinks.append(aCu);
        }

        esitoOut.append(fileLinks);
      }
    }
    loadHistory();
  } catch (e) {
    esitoOut.textContent = 'Errore di connessione durante la verifica dell’esito: ' + e.message;
  } finally {
    esitoBtn.disabled = false;
  }
}

// Bootstrap
try {
  const r = await fetch('/studio-ade-api?op=bootstrap', { credentials: 'same-origin', cache: 'no-store' });
  const d = await r.json();
  if (r.ok) {
    csrf = d.requesttoken;
    form.querySelector('fieldset').disabled = false;

    if (d.cuConfigured) {
      if (badge) {
        badge.textContent = 'Configurato';
        badge.style.background = '#d1fae5';
        badge.style.color = '#065f46';
      }
      out.replaceChildren();
      const msg = document.createElement('p');
      msg.className = 'banner';
      msg.dataset.state = 'ok';
      msg.textContent = '✓ Ambiente di sicurezza Entratel e credenziali CU operativi nel backend protetto.';
      out.append(msg);
      if (d.cuMetadata) {
        out.append(renderCerts(d.cuMetadata));
      }
      if (submitBtn) submitBtn.disabled = false;
      esitoBtn.disabled = false;
      loadHistory();
      loadCuClients();
      if (d.cuRateLimitWait && d.cuRateLimitWait > 0) {
        startRateLimitCountdown(d.cuRateLimitWait);
      }
    } else {
      if (badge) {
        badge.textContent = 'In attesa password';
        badge.style.background = '#fef3c7';
        badge.style.color = '#92400e';
      }
      out.replaceChildren();
      const msg = document.createElement('p');
      msg.className = 'banner';
      msg.dataset.state = 'pending';
      msg.innerHTML = '📁 <strong>Certificati Studio Associato studio-example rilevati:</strong> inserisci la password dell’ambiente di sicurezza nel modulo sottostante per attivarli.';
      out.append(msg);
      loadCuClients();
    }
  }
} catch {
  out.textContent = 'Configurazione non disponibile. Ricarica la pagina.';
}

// Diagnostics / Collaudo test button
if (diagBtn) {
  diagBtn.addEventListener('click', async () => {
    diagBtn.disabled = true;
    diagOut.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'banner';
    loading.textContent = 'Verifica in corso della firma digitale e raggiungibilità dei server Agenzia delle Entrate…';
    diagOut.append(loading);

    try {
      const r = await fetch('/studio-ade-api?op=cu-diagnostics', { credentials: 'same-origin', cache: 'no-store' });
      const d = await r.json();
      diagOut.replaceChildren();

      const resBox = document.createElement('div');
      resBox.className = 'banner';
      resBox.dataset.state = d.status === 'ready' ? 'ok' : 'error';

      let html = `<strong>${d.message || d.error || 'Risultato diagnostica'}</strong><ul style="margin:8px 0 0 18px;padding:0;font-size:13px">`;
      if (d.checks) {
        html += `<li>Ambiente sicurezza Entratel: ${d.checks.certs_configured ? '✓ Caricato' : '✗ Mancante'} (Intestatario: ${d.checks.cert_subject || '-'}, Scadenza: ${d.checks.cert_valid_to || '-'})</li>`;
        html += `<li>Firma JWT ModI: ${d.checks.jwt_signature_ok ? '✓ Corretta' : '✗ Errore'}</li>`;
        html += `<li>Client Secret AdE: ${d.checks.client_secret_present ? '✓ Presente' : '✗ Mancante'}</li>`;
        html += `<li>Gateway Agenzia Entrate (modipa): ${d.checks.gateway_reachable ? '✓ Connesso e raggiungibile' : '✗ Non raggiungibile'}</li>`;
      }
      html += `</ul>`;
      resBox.innerHTML = html;
      diagOut.append(resBox);
    } catch (e) {
      diagOut.textContent = 'Impossibile completare il test: ' + e.message;
    } finally {
      diagBtn.disabled = false;
    }
  });
}

// Submit Form (.ccf)
if (submitForm) {
  submitForm.addEventListener('submit', async event => {
    event.preventDefault();
    const file = document.getElementById('cu-file-input').files[0];
    if (!file) return;
    submitBtn.disabled = true;
    submitOut.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'banner';
    loading.textContent = 'Firma crittografica e invio telematico all’Agenzia delle Entrate in corso…';
    submitOut.append(loading);

    const data = new FormData(submitForm);
    try {
      const r = await fetch('/studio-ade-api?op=cu-submit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { requesttoken: csrf },
        body: data
      });
      const d = await r.json();
      submitOut.replaceChildren();

      if (!r.ok) {
        const err = document.createElement('p');
        err.className = 'banner';
        err.dataset.state = 'error';
        err.textContent = (d.error || 'Invio non riuscito.') + (d.retryAfter ? ' Riprova tra ' + d.retryAfter + ' secondi.' : '');
        submitOut.append(err);
        return;
      }

      const ok = document.createElement('p');
      ok.className = 'banner';
      ok.dataset.state = 'ok';
      ok.innerHTML = `✓ Richiesta CU inviata con successo all’Agenzia delle Entrate!<br><strong>Protocollo telematico assegnato: ${d.protocollo}</strong><br><small>${d.messaggio || ''}</small>`;
      submitOut.append(ok);
      protoInput.value = d.protocollo;
      submitForm.reset();
      loadHistory();
    } catch (e) {
      submitOut.textContent = 'Errore durante la sottomissione: ' + e.message;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// Esito button click
if (esitoBtn) {
  esitoBtn.addEventListener('click', () => checkEsito());
}

// Certificate management form
form.addEventListener('input', () => {
  verified = false;
  save.disabled = true;
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const storing = event.submitter === save;
  if (storing && !verified) return;
  const data = new FormData(form);
  if (storing) data.set('save', '1');
  const fieldset = form.querySelector('fieldset');
  fieldset.disabled = true;
  out.textContent = storing ? 'Salvataggio cifrato in corso…' : 'Controllo dei certificati in corso…';
  try {
    const r = await fetch('/studio-ade-api?op=cu-certificates', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { requesttoken: csrf },
      body: data
    });
    const d = await r.json();
    out.replaceChildren();
    const msg = document.createElement('p');
    msg.className = 'banner';
    msg.dataset.state = r.ok ? 'ok' : 'error';
    msg.textContent = d.error || d.message;
    out.append(msg);
    if (d.certificates) {
      out.append(renderCerts(d.certificates));
      verified = r.ok && Object.values(d.certificates).every(c => c.validNow);
    }
    if (d.saved) {
      form.reset();
      verified = false;
      if (badge) {
        badge.textContent = 'Configurato';
        badge.style.background = '#d1fae5';
        badge.style.color = '#065f46';
      }
      if (submitBtn) submitBtn.disabled = false;
      esitoBtn.disabled = false;
    }
  } catch {
    out.textContent = 'Operazione non completata. Nessuna conferma dal backend.';
    verified = false;
  } finally {
    fieldset.disabled = false;
    save.disabled = !verified;
  }
});
