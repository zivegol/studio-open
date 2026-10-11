/* Local decoding of DM 23/12/1976 fields; no assertion of assignment by AE. */
(function(root){
 'use strict';
 const months='ABCDEHLMPRST',digits='LMNPQRSTUV';
 const odd=[1,0,5,7,9,13,15,17,19,21,2,4,18,20,11,3,6,8,12,14,16,10,22,25,24,23];
 const normalize=value=>String(value||'').trim().toUpperCase();
 function checksum(value){let total=0;for(let i=0;i<15;i++){const c=value[i],n=/\d/.test(c)?Number(c):c.charCodeAt(0)-65;total+=i%2?n:odd[n];}return String.fromCharCode(65+total%26);}
 function decode(value,today=new Date()){
  const cf=normalize(value);
  if(/^\d{11}$/.test(cf))throw Error('Un codice fiscale numerico non contiene data e luogo di nascita. Compila i dati dal documento.');
  if(!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf))throw Error('Codice fiscale non valido: controlla i 16 caratteri e la loro posizione.');
  if(checksum(cf)!==cf[15])throw Error('Il carattere di controllo del codice fiscale non è corretto. Verifica il codice sul documento.');
  const chars=[...cf];let omocodia=false;
  for(const i of [6,7,9,10,12,13,14])if(digits.includes(chars[i])){chars[i]=String(digits.indexOf(chars[i]));omocodia=true;}
  const base=chars.join(''),yy=Number(base.slice(6,8)),month=months.indexOf(base[8])+1,encoded=Number(base.slice(9,11));
  if(!(encoded>=1&&encoded<=31||encoded>=41&&encoded<=71))throw Error('Il giorno di nascita codificato non è valido.');
  const day=encoded>40?encoded-40:encoded,years=[];
  // Explicit century selection, never infer an adult age from the transaction.
  for(let year=1800+yy;year<=today.getFullYear();year+=100){const dt=new Date(year,month-1,day);if(dt.getFullYear()===year&&dt.getMonth()===month-1&&dt.getDate()===day&&dt<=today)years.push(year);}
  if(!years.length)throw Error('La data codificata non esiste nel calendario o è futura.');
  return {cf,yy,month,day,years:years.reverse(),code:base.slice(11,15),omocodia};
 }
 function iso(d,year){if(!d.years.includes(Number(year)))throw Error('Seleziona l’anno completo di nascita.');return `${year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;}
 function date(d,year){const v=iso(d,year);return v.slice(8)+'/'+v.slice(5,7)+'/'+v.slice(0,4);}
 function places(index,code,birthday){
  const all=index.places[code]||[];
  const matched=birthday?all.filter(r=>(!r[2]||r[2]<=birthday)&&(!r[3]||r[3]>=birthday)):all;
  const unique=rows=>[...new Set(rows.map(r=>r[0]+(r[1]?` (${r[1]})`:'')))];
  return {options:unique(matched.length?matched:all),historicalFallback:!!birthday&&!!all.length&&!matched.length,unknown:!all.length};
 }
 const api={decode,checksum,normalize,iso,date,places};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FiscalCode=api;
})(typeof window!=='undefined'?window:globalThis);
