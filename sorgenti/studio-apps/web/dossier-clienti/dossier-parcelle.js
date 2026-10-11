/* Operational data stays in the parcelle database and is refreshed on every opening. */
(() => {
  const originalOpen = openClient;
  const euro = cents => new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR'}).format(Number(cents || 0)/100);
  const row = (label, value) => `<div class="fact"><label>${esc(label)}</label><strong>${esc(value || '—')}</strong></div>`;
  const table = (head, rows) => `<div class="table-scroll"><table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  async function refresh(id, panel) {
    panel.innerHTML='<h2>Contatti, accordi e avvisi</h2><p>Caricamento dati da Parcelle e fatture…</p>';
    try {
      const response=await fetch('/studio-parcelle-api?op=dossier_profile&clientId='+encodeURIComponent(id), {credentials:'same-origin',cache:'no-store'});
      if(!response.ok) throw Error('Dati parcelle non disponibili (HTTP '+response.status+').');
      const data=await response.json();
      if(!panel.isConnected) return;
      const title='<h2>Contatti, accordi e avvisi</h2><p class="note">Dati aggiornati da Parcelle e fatture. Le modifiche salvate nell’app sono disponibili riaprendo questa scheda o premendo Aggiorna.</p>';
      if(data.status!=='found') {
        panel.innerHTML=title+`<p>${data.status==='ambiguous'?'Più schede corrispondono a questo soggetto: verificare il collegamento al Dossier nell’app Parcelle e fatture.':'Nessuna scheda parcelle collegata. Importa questo cliente dal Dossier nell’app Parcelle e fatture.'}</p>`;
      } else {
        const c=data.client, notices=data.notices||[], invoices=data.invoices||[];
        panel.innerHTML=title+`<div class="grid">${row('Email per gli avvisi',c.email)}${row('PEC',c.pec)}${row('Codice SDI',c.sdi)}${row('Denominazione',c.name)}${row('Codice fiscale',c.cf)}${row('Partita IVA',c.vat)}${row('Indirizzo di fatturazione',[c.address,c.zip,c.city,c.province].filter(Boolean).join(' '))}${row('Periodicità',c.months?'Ogni '+c.months+' mesi':'Occasionale')}${row('Prossimo avviso',c.nextDate)}${row('Accordo',c.active?'Attivo':'Sospeso')}${row('IVA / cassa / ritenuta',`${c.vatRate}% / ${c.fundRate}% / ${c.withholdingRate}%`)}</div><h3>Compensi concordati</h3>`+
          table(['Prestazione','Tariffa unitaria','Quantità','Tipo'],(c.lines||[]).map(l=>`<tr><td>${esc(l.description)}</td><td>${euro(Number(l.amount)*100)}</td><td>${esc(l.quantity??1)}</td><td>${esc(l.basis==='quarter'?'Trimestre':'Prestazione')}</td></tr>`))+
          '<h3>Avvisi e incassi</h3>'+ (notices.length?table(['Avviso / data','Prestazioni','Netto','Incassato','Residuo','Invio email'],notices.map(n=>{
            const paid=(n.payments||[]).reduce((s,p)=>s+Number(p.amount||0),0);
            return `<tr><td>${esc(n.number)}<br>${esc(n.date)}${n.cancelled?'<br>Annullato':''}</td><td>${(n.lines||[]).map(l=>esc(l.description)).join('<br>')}${n.note?'<br>'+esc(n.note):''}</td><td>${euro(n.totals.net)}</td><td>${euro(paid)}</td><td>${n.cancelled?'—':euro(Math.max(0,n.totals.net-paid))}</td><td>${n.sentEmail?esc(n.sentEmail.to)+'<br>'+esc(n.sentEmail.at):'Non inviato'}</td></tr>`;
          })):'<p>Nessun avviso registrato.</p>')+
          '<h3>Fatture</h3>'+(invoices.length?table(['Numero','Data','Netto','Stato'],invoices.map(f=>`<tr><td>${esc(f.number)}</td><td>${esc(f.date)}</td><td>${euro(f.totals.net)}</td><td>${esc(f.status)}</td></tr>`)):'<p>Nessuna fattura registrata.</p>');
      }
      const actions=document.createElement('div'); actions.className='actions';
      const button=document.createElement('button'); button.textContent='Aggiorna dati parcelle';button.onclick=()=>refresh(id,panel); actions.append(button);
      const link=document.createElement('a');link.href='/studio-apps/avvisi-parcella/index.html?v=20261003-dossier1';link.textContent='Apri Parcelle e fatture';actions.append(link);panel.append(actions);
    } catch(e) { if(panel.isConnected){panel.textContent=e.message;const retry=document.createElement('button');retry.textContent='Riprova';retry.onclick=()=>refresh(id,panel);panel.append(retry);} }
  }
  openClient=function(id){originalOpen(id);if(!clients.some(c=>c.clientId===id))return;const panel=document.createElement('section');panel.className='section';panel.id='parcelle-profile';document.querySelector('#detail .dossier-hero').after(panel);refresh(id,panel);};
})();
