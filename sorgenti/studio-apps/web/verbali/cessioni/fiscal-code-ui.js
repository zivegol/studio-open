'use strict';
let fiscalIndexPromise=null,fiscalProposal=null;
function fiscalButton(p){return `<button type="button" data-fiscal="${esc(p.id)}">Ricava nascita dal codice fiscale${p.kind==='company'?' del firmatario':''}</button>`;}
document.addEventListener('click',e=>{if(e.target.dataset.fiscal)run(()=>openFiscal(e.target.dataset.fiscal));});
async function openFiscal(id){
 if(record?.status==='final')throw Error('L’atto definitivo non è modificabile.');
 const p=data.parties.find(p=>p.id===id);if(!p)return;
 const representative=p.kind==='company',cf=representative?p.representativeTaxCode:p.taxCode;
 const decoded=FiscalCode.decode(cf);
 if(!fiscalIndexPromise)fiscalIndexPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='birthplaces-data.js?v=20261006';script.onload=()=>{script.remove();window.CessioniBirthplaces?.places?resolve(window.CessioniBirthplaces):reject(Error('Archivio luoghi non valido.'));};script.onerror=()=>{script.remove();reject(Error('Archivio luoghi non disponibile.'));};document.head.appendChild(script);}).catch(e=>{fiscalIndexPromise=null;throw e;});
 const index=await fiscalIndexPromise;
 fiscalProposal={id,representative,decoded,index};
 const existingDate=representative?p.representativeBirth:p.birthDate,existingPlace=representative?p.representativeBirth:p.birthPlace;
 const match=String(existingDate||'').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
 const selected=match&&Number(match[1])===decoded.day&&Number(match[2])===decoded.month&&decoded.years.includes(Number(match[3]))?Number(match[3]):'';
 $('fiscalSummary').textContent=`${p.name||'Parte'}${representative?' — firmatario':''}: ${decoded.cf}. Giorno ${decoded.day}, mese ${decoded.month}, anno terminante in ${String(decoded.yy).padStart(2,'0')}. Codice luogo ${decoded.code}.${decoded.omocodia?' Riconosciuta omocodia.':''}`;
 $('fiscalYear').innerHTML='<option value="">Conferma il secolo…</option>'+decoded.years.map(y=>`<option value="${y}" ${y===selected?'selected':''}>${FiscalCode.date(decoded,y)}</option>`).join('');
 $('fiscalExisting').textContent=representative?`Dati attuali del firmatario: ${existingDate||'non compilati'}`:`Data attuale: ${existingDate||'non compilata'}. Luogo attuale: ${existingPlace||'non compilato'}.`;
 $('fiscalDateRow').hidden=representative;
 $('fiscalPlaceRow').hidden=representative;
 $('fiscalCombinedRow').hidden=!representative;
 $('fiscalUseDate').checked=!existingDate;$('fiscalUsePlace').checked=!existingPlace;$('fiscalUseCombined').checked=!existingDate;
 $('fiscalUseDate').nextElementSibling.textContent=existingDate?'Sostituisci la data già presente':'Compila la data di nascita';
 $('fiscalUsePlace').nextElementSibling.textContent=existingPlace?'Sostituisci il luogo già presente':'Compila il luogo di nascita';
 $('fiscalUseCombined').nextElementSibling.textContent=existingDate?'Sostituisci i dati di nascita già presenti del firmatario':'Compila i dati di nascita del firmatario';
 updateFiscalPlace();$('fiscalDialog').showModal();
}
function updateFiscalPlace(){
 const {decoded,index}=fiscalProposal,year=$('fiscalYear').value;
 const result=FiscalCode.places(index,decoded.code,year?FiscalCode.iso(decoded,year):'');
 $('fiscalPlace').innerHTML=(result.options.length===1?'':'<option value="">Seleziona il luogo…</option>')+result.options.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
 $('fiscalLookupNote').textContent=result.unknown?'Codice luogo assente dall’archivio locale: puoi ricavare la data e compilare il luogo dal documento.':result.historicalFallback?'Nessuna denominazione valida alla data selezionata: sono mostrate le corrispondenze storiche da verificare sul documento.':'Denominazioni tratte dall’archivio ANPR'+(year?' per la data selezionata.':': scegli la data completa per individuare la denominazione storica.');
 if(result.unknown)$('fiscalUsePlace').checked=false;
}
document.addEventListener('DOMContentLoaded',()=>{
 $('fiscalYear').onchange=updateFiscalPlace;
 $('fiscalCancel').onclick=()=>$('fiscalDialog').close();
 $('fiscalApply').onclick=()=>{
  try{
   if(record?.status==='final')throw Error('Il definitivo non è modificabile.');
   const {id,representative,decoded,index}=fiscalProposal,p=data.parties.find(p=>p.id===id);
   if(!p||FiscalCode.normalize(representative?p.representativeTaxCode:p.taxCode)!==decoded.cf)throw Error('Il codice fiscale è cambiato: ricalcola la proposta.');
   const useDate=representative?$('fiscalUseCombined').checked:$('fiscalUseDate').checked,usePlace=representative?$('fiscalUseCombined').checked:$('fiscalUsePlace').checked;
   if(!useDate&&!usePlace)throw Error('Seleziona quali dati applicare; quelli esistenti sono preservati.');
   const year=$('fiscalYear').value,date=FiscalCode.date(decoded,year),place=$('fiscalPlace').value;
   if(usePlace&&!place)throw Error('Luogo non individuato: compilalo dal documento oppure applica soltanto la data.');
   if(representative)p.representativeBirth=`nato/a a ${place} il ${date}`;
   else{if(useDate)p.birthDate=date;if(usePlace)p.birthPlace=place;}
   p[representative?'representativeBirthDerivation':'birthDerivation']={method:'codice-fiscale',taxCode:decoded.cf,code:decoded.code,date:useDate?date:null,place:usePlace?place:null,confirmedAt:new Date().toISOString(),dataset:index.version};
   changed();render();$('fiscalDialog').close();message('Dati ricavati dal codice fiscale applicati. Verificali sul documento di identità e salva la bozza.');
  }catch(e){$('fiscalLookupNote').textContent=e.message;}
 };
});
