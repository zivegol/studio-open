// Uses the same shared state, form and request helpers as app.js.
function defaultQuarter(){
    const d=new Date();const q=Math.floor(d.getMonth()/3);
    return {year:q===0?d.getFullYear()-1:d.getFullYear(),quarter:q===0?4:q};
}
function quarterFields(optional=false){
    const p=defaultQuarter();
    return `<fieldset class="quarter-fields"><legend>Periodo di riferimento</legend>${optional?'<label class="check"><input type="checkbox" name="periodEnabled" checked> Esponi il trimestre nell’avviso</label>':''}
        ${input('periodYear','Anno di riferimento',p.year,'number',true)}
        <div class="quarter-options">${['Gennaio – marzo','Aprile – giugno','Luglio – settembre','Ottobre – dicembre'].map((label,i)=>`<label class="check"><input type="checkbox" name="periodQuarter" value="${i+1}" ${p.quarter===i+1?'checked':''}><span><b>${i+1}° trimestre</b><br><small>${label}</small></span></label>`).join('')}</div></fieldset>`;
}
function serviceFields(){
    return `<div class="formsection">${select('servicePreset','Descrizione comune',[
        ['accounting','Tenuta contabilità ed adempimenti fiscali'],
        ['f24','Generazione e trasmissione F24'],
        ['custom','Personalizzata'],
        ['individual','Solo descrizioni dei singoli accordi']],'accounting')}
        ${input('serviceDescription','Testo da esporre nell’avviso','Tenuta contabilità ed adempimenti fiscali')}
        <p class="muted">La descrizione compare sopra le righe. I prezzi unitari e le aliquote restano quelli dei singoli accordi. Le quantità trimestrali seguono i periodi selezionati.</p></div>`;
}
function quarterlyEditor(draft){
    const cs=values(S.clients).filter(c=>c.active);
    if(!cs.length){message('Configura almeno un cliente con accordo attivo prima di generare gli avvisi trimestrali.');return;}
    openDialog(`<h2>Avvisi trimestrali · operazione massiva</h2>${quarterFields()}${input('date','Data degli avvisi',today(),'date',true)}${serviceFields()}
        <div class="formsection"><div class="sectionhead"><h3>Clienti da includere</h3><div>${button('Seleziona tutti','quarterSelectAll')}${button('Deseleziona tutti','quarterSelectNone')}</div></div>
        <p class="muted">Sono preselezionati gli accordi trimestrali attivi. I prezzi unitari sono quelli dell’accordo. Le righe per trimestre vengono moltiplicate per i trimestri selezionati; F24 e prestazioni mantengono la quantità standard.</p>
        ${table(['Selezione','Cliente / righe standard','Periodicità','Netto'],cs.map(c=>`<tr><td><input class="quarter-client" aria-label="Seleziona ${esc(c.name)}" type="checkbox" value="${esc(c.id)}" ${c.months===3?'checked':''}></td><td><b>${esc(c.name)}</b><br><small>${c.lines.map(l=>esc(l.description)).join(' · ')}</small></td><td>${c.months===3?'Trimestrale':c.months?'Ogni '+c.months+' mesi':'Occasionale'}</td><td class="right" data-quarter-net="${esc(c.id)}">${eur(calc(c.lines,c).net)}</td></tr>`))}
        <p id="quarterSelection" class="summary"></p></div>
        <label class="check"><input type="checkbox" name="advanceSchedule" checked> Aggiorna la prossima data degli accordi trimestrali</label>
        <p class="muted">Se la prossima data è già trascorsa, passa alla prima scadenza successiva alla data degli avvisi. L’anteprima mostra le date aggiornate; gli altri accordi mantengono la loro periodicità.</p>`,async()=>{
            const data=getForm();data.clientIds=Array.from(document.querySelectorAll('.quarter-client:checked')).map(el=>el.value);
            data.advanceSchedule=$('#form [name=advanceSchedule]').checked;
            const result=await request('quarter_preview',data);quarterlyPreview(data,result.preview);return false;
        },'Mostra anteprima');
    if(draft){
        for(const name of ['periodYear','date','servicePreset','serviceDescription'])$('#form [name='+name+']').value=draft[name]??'';
        for(const radio of document.querySelectorAll('[name=periodQuarter]'))radio.checked=(draft.periodQuarters||[draft.periodQuarter]).map(String).includes(radio.value);
        for(const cb of document.querySelectorAll('.quarter-client'))cb.checked=draft.clientIds.includes(cb.value);
        $('#form [name=advanceSchedule]').checked=!!draft.advanceSchedule;
    }
    syncServiceDescription(false);updateQuarterSelection();
}
function quarterlyPreview(payload,plan){
    const rows=plan.rows;
    openDialog(`<h2>Anteprima · ${esc(plan.period.label)}</h2><p>Data avvisi: <b>${dt(plan.date)}</b> · ${rows.length} avvisi da creare · netto complessivo <b>${eur(plan.net)}</b></p>
        <p class="note">${esc(plan.serviceDescription)||'Descrizioni delle righe previste nei singoli accordi'}<br>Periodo: ${esc(plan.period.label)} · ${periodDates(plan.period)}</p>
        ${table(['Cliente','Compensi','Netto','Scadenza pagamento','Prossimo avviso'],rows.map(r=>`<tr><td>${esc(r.name)}<br><small>${r.lines.map(l=>esc(l.description)).join(' · ')}</small></td><td>${eur(r.totals.base)}</td><td>${eur(r.totals.net)}</td><td>${dt(r.due)}</td><td>${dt(r.previousNextDate)}${r.nextDate!==r.previousNextDate?' → '+dt(r.nextDate):' (invariata)'}</td></tr>`))}
        ${plan.skipped.length?`<p class="note"><b>${plan.skipped.length} clienti esclusi per sovrapposizione con trimestri già addebitati:</b><br>${plan.skipped.map(c=>esc(c.name)+' · avviso '+esc(c.number)).join('<br>')}</p>`:''}
        <p class="muted">La conferma crea gli avvisi nell’archivio. Non invia documenti e non genera fatture.</p>${button('Modifica selezione','quarterBack')}`,rows.length?async()=>{
            const result=await save('quarter_bulk',payload);message(`${result.created.length} avvisi creati · ${result.period}${result.skipped?' · '+result.skipped+' già presenti, esclusi':''}.`);
        }:null,`Crea ${rows.length} avvisi`);
    $('#form [data-action=quarterBack]').onclick=()=>quarterlyEditor(payload);
}
function updateQuarterSelection(){
    const label=$('#quarterSelection');if(!label)return;document.querySelectorAll('[data-quarter-net]').forEach(el=>{const c=S.clients[el.dataset.quarterNet];el.textContent=eur(calc(bulkClientLines(c),c).net);});
    const ids=Array.from(document.querySelectorAll('.quarter-client:checked')).map(el=>el.value);
    label.textContent=`${ids.length} clienti selezionati · ${eur(ids.reduce((sum,id)=>sum+calc(bulkClientLines(S.clients[id]),S.clients[id]).net,0))} netto prima dell’esclusione dei duplicati`;
}
function syncServiceDescription(change=true){
    const preset=$('#form [name=servicePreset]'),field=$('#form [name=serviceDescription]');if(!preset||!field)return;
    const texts={accounting:'Tenuta contabilità ed adempimenti fiscali',f24:'Generazione e trasmissione F24',individual:''};
    if(change && preset.value in texts)field.value=texts[preset.value];
    field.readOnly=preset.value==='individual';field.maxLength=200;
}
actions.quarterly=()=>quarterlyEditor();
actions.quarterSelectAll=()=>{document.querySelectorAll('.quarter-client').forEach(el=>el.checked=true);updateQuarterSelection();};
actions.quarterSelectNone=()=>{document.querySelectorAll('.quarter-client').forEach(el=>el.checked=false);updateQuarterSelection();};
document.addEventListener('change',event=>{
    if(event.target.matches('.quarter-client'))updateQuarterSelection();
    if(event.target.name==='servicePreset')syncServiceDescription();
    if(event.target.name==='periodQuarter'||event.target.name==='periodYear'||event.target.matches('.basis')){syncQuarterQuantities();updateQuarterSelection();}
    if(event.target.name==='periodEnabled'){
        const enabled=event.target.checked;
        document.querySelectorAll('[name=periodYear],[name=periodQuarter]').forEach(el=>el.disabled=!enabled);syncQuarterQuantities();
    }
});

function periodDates(p){return (p.ranges||[{start:p.start,end:p.end}]).map(r=>'Dal '+dt(r.start)+' al '+dt(r.end)).join('; ');}
function selectedQuarterCount(){return document.querySelectorAll('#form [name=periodQuarter]:checked:not(:disabled)').length;}
function bulkClientLines(c){return c.lines.map(l=>({...l,quantity:l.basis==='quarter'?selectedQuarterCount():(l.quantity??1)}));}
function syncQuarterQuantities(){
    const count=selectedQuarterCount();
    if(!count)return;
    document.querySelectorAll('#lines .line').forEach(el=>{
        const desc=(el.querySelector('.description')?.value||'').toLowerCase();
        const basis=el.querySelector('.basis');
        if(basis && (basis.value==='quarter'||desc.includes('contabilit'))){
            basis.value='quarter';
            el.querySelector('.quantity').value=count;
        }
    });
    updateTotal();
    if(typeof window.onQuartersChanged==='function') window.onQuartersChanged();
}
