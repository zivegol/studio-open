'use strict';
const $=s=>document.querySelector(s), entries=[];let current=null,seq=0;
const children=(n,name)=>Array.from(n?.children||[]).filter(x=>!name||x.localName===name);
const child=(n,name)=>children(n,name)[0];
const path=(n,p)=>p.split('/').reduce((v,k)=>child(v,k),n);
const value=(n,p)=>path(n,p)?.textContent.trim()||'';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=s=>s.replace(/([a-zà-ù])([A-Z])/g,'$1 $2');
const number=s=>s!==''&&Number.isFinite(Number(s))?Number(s):null;
const fmt=s=>number(s)===null?(s||'—'):new Intl.NumberFormat('it-IT',{maximumFractionDigits:8}).format(Number(s));
const amount=s=>number(s)===null?'Non indicato':new Intl.NumberFormat('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(s));
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)?s.split('-').reverse().join('/'):s||'—';
function party(n){let a=path(n,'DatiAnagrafici/Anagrafica');return value(a,'Denominazione')||[value(a,'Nome'),value(a,'Cognome')].filter(Boolean).join(' ')||'Non indicato';}
function parse(text,name){if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Dichiarazioni DTD o entità non ammesse');let doc=new DOMParser().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('XML non valido');let root=doc.documentElement;if(root.localName!=='FatturaElettronica')throw Error('Il file non è una FatturaElettronica ordinaria');let header=child(root,'FatturaElettronicaHeader'),bodies=children(root,'FatturaElettronicaBody');if(!header||!bodies.length)throw Error('Intestazione o corpo della fattura assenti');return bodies.map((body,i)=>{let general=path(body,'DatiGenerali/DatiGeneraliDocumento');if(!general)throw Error('Dati generali documento assenti');return{id:++seq,name,part:i+1,parts:bodies.length,header,body,general,seller:party(child(header,'CedentePrestatore')),buyer:party(child(header,'CessionarioCommittente')),num:value(general,'Numero'),day:value(general,'Data'),currency:value(general,'Divisa')||'Valuta non indicata',type:value(general,'TipoDocumento'),total:value(general,'ImportoTotaleDocumento')};});}
let importing=false;
async function load(files){
 if(importing)return;
 const all=Array.from(files),xmlFiles=all.filter(f=>/\.xml$/i.test(f.name)),ignored=all.length-xmlFiles.length;
 let processed=0,ok=0,docs=0;const errors=[];
 importing=true;for(const id of ['files','folder','clear'])$('#'+id).disabled=true;
 const status=()=>{$('#import-status').textContent='Importazione: '+processed+' / '+xmlFiles.length+' file XML · '+ok+' validi · '+errors.length+' non importati · '+ignored+' file non XML ignorati';};status();
 try{for(const file of xmlFiles){
  const name=file.webkitRelativePath||file.name;
  try{
   if(file.size>20*1024*1024)throw Error('File superiore a 20 MB');
   const buf=await file.arrayBuffer(),prefix=new TextDecoder().decode(buf.slice(0,250));
   const encoding=prefix.match(/encoding\s*=\s*['"]([^'"]+)/i)?.[1]||(new Uint8Array(buf)[0]===255?'utf-16le':new Uint8Array(buf)[0]===254?'utf-16be':'utf-8');
   const parsed=parse(new TextDecoder(encoding,{fatal:true}).decode(buf),name);
   for(const entry of parsed)entries.push(entry);
   ok++;docs+=parsed.length;if(!current)current=parsed[0].id;
  }catch(e){errors.push(name+': '+e.message);}
  processed++;if(processed%20===0){status();await new Promise(resolve=>setTimeout(resolve,0));}
 }
 $('#messages').innerHTML=errors.length?'<details><summary>'+errors.length+' file XML non importati: mostra elenco</summary>'+errors.map(e=>'<p>'+esc(e)+'</p>').join('')+'</details>':'';
 $('#import-status').textContent='Importazione completata: '+ok+' file XML validi, '+docs+' documenti aggiunti; '+errors.length+' XML non importati; '+ignored+' file non XML ignorati.';
 renderList();render();
 }finally{importing=false;for(const id of ['files','folder','clear'])$('#'+id).disabled=false;}
}

const codes=n=>children(n,'CodiceArticolo').map(c=>value(c,'CodiceValore')).filter(Boolean).join(' · ');
const cell=(n,p)=>p==='@codes'?codes(n):value(n,p);
const lineQuery=()=>$('#line-search').value.trim().toLocaleLowerCase('it');
const lines=e=>children(child(e.body,'DatiBeniServizi'),'DettaglioLinee');
function filteredLines(e){const q=lineQuery(),mode=$('#line-mode').value;return lines(e).filter(n=>!q||[...(mode!=='text'?[codes(n)]:[]),...(mode!=='code'?[value(n,'Descrizione')]:[])].some(s=>s.toLocaleLowerCase('it').includes(q)));}
function lineSection(e){const found=filteredLines(e),active=!!lineQuery();return '<p>'+found.length+' di '+lines(e).length+' righe'+(active?' · Filtro: '+esc($('#line-search').value.trim()):'')+'</p>'+(active?'<p class="muted">Stampa e CSV includono le righe filtrate. I totali e i riepiloghi IVA restano quelli dell’intera fattura.</p>':'')+(found.length?table(found,lineCols):'<p class="muted">Nessuna riga corrispondente.</p>');}
function renderList(){const q=$('#search').value.toLowerCase();const shown=entries.filter(e=>[e.num,e.seller,e.buyer,e.name,e.day].join(' ').toLowerCase().includes(q)&&(!lineQuery()||filteredLines(e).length));if(lineQuery()&&!shown.some(e=>e.id===current))current=shown[0]?.id??null;$('#count').textContent=shown.length+' di '+entries.length+' documenti';$('#list').innerHTML=shown.map(e=>`<button data-id="${e.id}" class="${e.id===current?'active':''}" aria-current="${e.id===current}"><b>${esc(e.num||'Senza numero')} · ${esc(date(e.day))}</b><span>${esc(e.seller)}</span><span>${esc(amount(e.total))} ${esc(e.currency)}</span></button>`).join('');}
function fields(n){return '<dl>'+children(n).filter(c=>!c.children.length).map(c=>`<div><dt>${esc(label(c.localName))}</dt><dd>${esc(c.textContent.trim()||'—')}</dd></div>`).join('')+'</dl>';}
function tree(n){return children(n).map(c=>{if(c.localName==='Attachment')return '<p class="muted">Contenuto binario allegato omesso dalla visualizzazione.</p>';return c.children.length?`<details><summary>${esc(label(c.localName))}</summary>${tree(c)}</details>`:`<dl><div><dt>${esc(label(c.localName))}</dt><dd>${esc(c.textContent.trim()||'—')}</dd></div></dl>`;}).join('');}
function table(nodes,cols){if(!nodes.length)return '<p class="muted">Non presenti nel documento.</p>';return '<div class="scroll"><table><thead><tr>'+cols.map(c=>`<th>${esc(c[1])}</th>`).join('')+'</tr></thead><tbody>'+nodes.map(n=>'<tr>'+cols.map(c=>`<td class="${c[2]?'num':''}">${esc(c[2]?fmt(cell(n,c[0])):cell(n,c[0])||'—')}</td>`).join('')+'</tr>').join('')+'</tbody></table></div>';}
const lineCols=[['NumeroLinea','N.'],['@codes','Codice articolo'],['Descrizione','Descrizione'],['Quantita','Quantità',1],['UnitaMisura','U.M.'],['PrezzoUnitario','Prezzo unitario',1],['PrezzoTotale','Totale riga',1],['AliquotaIVA','IVA %',1],['Natura','Natura']];
function render(){let e=entries.find(e=>e.id===current);if(!e){$('#detail').innerHTML='<div class="empty"><h2>Nessuna fattura selezionata</h2><p>Carica un file XML oppure modifica i filtri per visualizzare i documenti.</p></div>';return;}let goods=child(e.body,'DatiBeniServizi'),iva=children(goods,'DatiRiepilogo');let sum=key=>iva.length&&iva.every(n=>number(value(n,key))!==null)?String(iva.reduce((s,n)=>s+Number(value(n,key)),0)):'';$('#detail').innerHTML=`<small>${esc(e.type||'DOCUMENTO')}</small><h1>Fattura ${esc(e.num||'senza numero')}</h1><p>${esc(date(e.day))} · ${esc(e.currency)}</p><p class="filename">${esc(e.name)}${e.parts>1?' · Documento '+e.part+' di '+e.parts:''}</p><div class="toolbar"><button id="print">Stampa / Salva PDF</button><button id="csv" class="secondary">Esporta righe CSV</button></div><div class="cards"><div class="card">Imponibile / importi riepiloghi IVA<strong>${esc(amount(sum('ImponibileImporto')))}</strong></div><div class="card">Imposta dei riepiloghi<strong>${esc(amount(sum('Imposta')))}</strong></div><div class="card">Totale documento · ${esc(e.currency)}<strong>${esc(amount(e.total))}</strong></div></div><p class="muted">Importi riportati nell’XML. Il totale documento può includere bollo, ritenute e altri aggiustamenti; non coincide necessariamente con l’importo da pagare.</p><div class="parties">${['CedentePrestatore','CessionarioCommittente'].map((key,i)=>{let n=child(e.header,key);return `<section><h3>${i?'Cliente':'Fornitore'} · ${esc(party(n))}</h3>${tree(n)}</section>`;}).join('')}</div><section class="section"><h2>Dati del documento</h2>${fields(e.general)}${children(e.general).filter(n=>n.children.length).map(n=>`<details><summary>${esc(label(n.localName))}</summary>${tree(n)}</details>`).join('')}</section><section class="section"><h2>Righe della fattura</h2>${lineSection(e)}</section><section class="section"><h2>Riepilogo IVA</h2>${table(iva,[['AliquotaIVA','IVA %',1],['Natura','Natura'],['ImponibileImporto','Imponibile / importo',1],['Imposta','Imposta',1],['EsigibilitaIVA','Esigibilità'],['RiferimentoNormativo','Riferimento normativo']])}</section><section class="section"><h2>Pagamenti e scadenze</h2>${children(e.body,'DatiPagamento').map(n=>fields(n)+table(children(n,'DettaglioPagamento'),[['Beneficiario','Beneficiario'],['ModalitaPagamento','Modalità'],['DataScadenzaPagamento','Scadenza'],['ImportoPagamento','Importo',1],['IBAN','IBAN'],['IstitutoFinanziario','Istituto']])).join('')||'<p class="muted">Non indicati nel documento.</p>'}</section><details><summary>Tutti i dati XML · sconti, ritenute, riferimenti e allegati</summary><h3>Intestazione</h3>${tree(e.header)}<h3>Documento</h3>${tree(e.body)}</details>`;$('#print').onclick=()=>window.print();$('#csv').onclick=()=>csv(e);}
function csv(e){let cols=lineCols.map(c=>c[1]);const safe=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,m=>"'"+m).replace(/"/g,'""')+'"';let rows=filteredLines(e).map(n=>lineCols.map(c=>cell(n,c[0])));let blob=new Blob(['\ufeff'+[cols,...rows].map(r=>r.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});let url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fattura-'+(e.num||'righe').replace(/[^a-z0-9_-]/gi,'_')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#files').onchange=async ev=>{await load(ev.target.files);ev.target.value='';};$('#search').oninput=()=>{renderList();render();};$('#list').onclick=ev=>{let b=ev.target.closest('button[data-id]');if(b){current=Number(b.dataset.id);renderList();render();}};$('#clear').onclick=()=>{entries.length=0;current=null;$('#messages').textContent='';$('#import-status').textContent='';renderList();render();};for(let type of ['dragenter','dragover'])$('#drop').addEventListener(type,e=>{e.preventDefault();$('#drop').classList.add('over');});$('#drop').addEventListener('dragleave',()=>$('#drop').classList.remove('over'));$('#drop').addEventListener('drop',e=>{e.preventDefault();$('#drop').classList.remove('over');load(e.dataTransfer.files);});

function applyLineFilter(){if(!current&&entries.length)current=entries[0].id;renderList();render();}
$('#line-search').oninput=applyLineFilter;$('#line-mode').onchange=applyLineFilter;$('#reset-filter').onclick=()=>{$('#line-search').value='';$('#line-mode').value='all';applyLineFilter();};

$('#folder').onchange=async ev=>{await load(ev.target.files);ev.target.value='';};
