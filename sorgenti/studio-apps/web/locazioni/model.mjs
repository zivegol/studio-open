export const SCHEMA=1;
export const emptyState=()=>({schemaVersion:SCHEMA,properties:[],contracts:[],payments:[],reminders:[]});
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
export function eurosToCents(value){const s=String(value).trim().replace(',','.');if(!/^\d{1,8}(\.\d{1,2})?$/.test(s))throw Error('Inserisci un importo positivo con al massimo due decimali.');const [a,b='']=s.split('.');return Number(a)*100+Number(b.padEnd(2,'0'));}
export const currency=cents=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(cents/100);
export const dateLabel=s=>validDate(s)?s.split('-').reverse().join('/'):'—';
export function installments(c){
 if(!validDate(c.start)||!validDate(c.end)||c.start>c.end||![1,3,6,12].includes(c.frequency))return [];
 const [year,month]=c.start.split('-').map(Number),out=[];
 for(let offset=0;offset<=600;offset+=c.frequency){
  const date=new Date(Date.UTC(year,month-1+offset,1,12));const y=date.getUTCFullYear(),m=date.getUTCMonth()+1;
  const period=`${y}-${String(m).padStart(2,'0')}`;
  if(period>c.end.slice(0,7))break;
  const max=new Date(Date.UTC(y,m,0,12)).getUTCDate();
  let due=`${period}-${String(Math.min(c.dueDay,max)).padStart(2,'0')}`;
  if(due<c.start)due=c.start;
  if(due>c.end)break;
  out.push({key:`${c.id}:${period}`,contractId:c.id,period,due,amount:c.rentCents});
 }
 return out;
}
export function ledger(state,asOf=today()){
 const paid=new Map();for(const p of state.payments){if(!p.voided&&p.date<=asOf)paid.set(p.installmentKey,(paid.get(p.installmentKey)||0)+p.amountCents);}
 return state.contracts.flatMap(c=>installments(c).map(r=>({...r,contract:c,paid:paid.get(r.key)||0,remaining:Math.max(0,r.amount-(paid.get(r.key)||0))})))
 .map(r=>({...r,status:r.remaining===0?'paid':r.due<asOf?'overdue':'pending'})).sort((a,b)=>a.due.localeCompare(b.due)||a.key.localeCompare(b.key));
}
export function overview(state,asOf=today()){
 const rows=ledger(state,asOf).filter(r=>!r.contract.archived);const month=asOf.slice(0,7);
 const active=state.contracts.filter(c=>!c.archived&&c.start<=asOf&&c.end>=asOf);
 return {active:active.length,monthlyCents:active.reduce((n,c)=>n+Math.round(c.rentCents/c.frequency),0),overdueCents:rows.filter(r=>r.status==='overdue').reduce((n,r)=>n+r.remaining,0),collectedCents:state.payments.filter(p=>!p.voided&&p.date.startsWith(month)&&p.date<=asOf).reduce((n,p)=>n+p.amountCents,0)};
}
export function upcoming(state,asOf=today(),days=60){
 const limit=new Date(asOf+'T12:00:00Z');limit.setUTCDate(limit.getUTCDate()+days);const end=limit.toISOString().slice(0,10);
 const items=state.reminders.filter(r=>!r.done).map(r=>({...r,kind:'Promemoria'}));
 for(const c of state.contracts.filter(c=>!c.archived))items.push({id:'end-'+c.id,contractId:c.id,title:'Fine contratto',date:c.end,kind:'Contratto'});
 return items.filter(r=>r.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
}
