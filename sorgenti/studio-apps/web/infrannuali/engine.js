(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.InterimEngine=api;})(globalThis,()=>{
'use strict';
const categories={A1:'Ricavi delle vendite e prestazioni',A2:'Variazione prodotti e semilavorati',A3:'Variazione lavori in corso',A4:'Incrementi per lavori interni',A5:'Altri ricavi e proventi',B6:'Materie, consumi e merci',B7:'Servizi',B8:'Godimento beni di terzi',B9:'Personale',B10a:'Ammortamenti immateriali',B10b:'Ammortamenti materiali',B10c:'Svalutazioni immobilizzazioni',B10d:'Svalutazioni crediti',B11:'Variazione rimanenze materie e merci',B12:'Accantonamenti per rischi',B13:'Altri accantonamenti',B14:'Oneri diversi di gestione',C15:'Proventi da partecipazioni',C16:'Altri proventi finanziari',C17:'Interessi e oneri finanziari',C17bis:'Utili e perdite su cambi',D18:'Rivalutazioni finanziarie',D19:'Svalutazioni finanziarie',T20:'Imposte sul reddito',NC:'Da classificare'};
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function number(v){if(typeof v==='number')return Number.isFinite(v)?v:null;if(v==null||String(v).trim()==='')return null;let s=String(v).trim().replace(/[€\s\u00a0]/g,'');if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return /^[-+]?\d+(\.\d+)?$/.test(s)?Number(s):null;}
function date(d,m,y){y=+y<100?2000+(+y):+y;const v=new Date(Date.UTC(y,+m-1,+d));return v.getUTCFullYear()===y&&v.getUTCMonth()===+m-1&&v.getUTCDate()===+d?v.toISOString().slice(0,10):null;}
function dates(text){return [...String(text).matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g)].map(m=>date(m[1],m[2],m[3])).filter(Boolean);}
function propose(a){const t=a.description.toLowerCase();let cee='NC',behavior='Da valutare',reason='Descrizione non sufficiente';
 const rules=[[/svalutaz.*credit/,'B10d'],[/svalutaz.*immobil/,'B10c'],[/ammort.*immaterial/,'B10a'],[/ammort/,'B10b'],[/accanton.*risch/,'B12'],[/accanton/,'B13'],[/\b(ires|irap)\b|imposte sul reddito/,'T20'],[/interessi passivi|oneri finanziari/,'C17'],[/interessi attivi|proventi finanziari/,'C16'],[/dividendi|proventi da partecip/,'C15'],[/utili.*cambi|perdite.*cambi/,'C17bis'],[/variaz.*rimanenz.*(mater|merci)/,'B11'],[/variaz.*(prodott|semilavor)/,'A2'],[/lavori in corso/,'A3'],[/increment.*lavori intern/,'A4'],[/stipendi|salari|oneri sociali|inail|trattamento.*fine.*rapporto|\btfr\b/,'B9'],[/leasing|locazioni passive|affitti passivi|noleggi/,'B8'],[/imposta di bollo|\bimu\b|diritti camerali|tasse|imposte.*deducibili|contributi sindacali|arrotondamenti passivi/,'B14']];
 for(const [re,c] of rules)if(re.test(t)){cee=c;reason='Proposta dalla descrizione del conto';break;}
 if(cee==='NC'&&a.side==='revenue'){if(/vendite|prestazioni di servizi/.test(t))cee='A1';else if(/contributi in conto esercizio|locazioni attive|rimborsi|arrotondamenti attivi|altri ricavi/.test(t))cee='A5';reason='Proposta dalla descrizione del ricavo';}
 if(cee==='NC'&&a.side==='cost'){if(/materi[ae]|prodotti finiti|merci|carburanti|cancelleria|pezzi di ricambio|beni di importo|indumenti/.test(t))cee='B6';else if(/spese|servizi|lavorazioni|energia|manutenzione|consulenz|assicuraz|provvigioni|utenze|visite|buoni pasto/.test(t))cee='B7';reason='Proposta dalla descrizione del costo';}
 return {cee,behavior,variableShare:behavior==='Variabile'?100:behavior==='Fisso'?0:null,confirmed:false,reason};
}
function parseWorkbook(wb,X,file){const snapshots=[],rejected=[];for(const sheet of wb.SheetNames){try{
 const ws=wb.Sheets[sheet];if(!ws['!ref'])continue;const range=X.utils.decode_range(ws['!ref']);const rows=X.utils.sheet_to_json(ws,{header:1,defval:null,raw:true,range:{s:{r:0,c:0},e:range.e}});
 const flat=rows.slice(0,15).flat().filter(v=>typeof v==='string');const entityCell=flat.find(s=>/partita iva|codice fiscale/i.test(s));const entity=entityCell?entityCell.split(/\r?\n/)[0].trim():null;
 const periodText=flat.find(s=>/dal\s+\d.+al\s+\d/i.test(s));const pd=dates(periodText||'');const named=dates(sheet);let start=pd[0]||null,end=pd[1]||null;const issues=[];
 if(!entity)issues.push('Intestazione cliente non riconosciuta');if(!start||!end)issues.push('Periodo iniziale/finale non riconosciuto');if(named.length&&end&&named.at(-1)!==end)issues.push('Data del foglio diversa dalla data finale in intestazione');
 let section=null,cols=null;const accounts=[],totals={};let headers=0;
 for(let r=0;r<rows.length;r++){
 const row=rows[r],texts=row.map(v=>typeof v==='string'?v.trim().toUpperCase():'');
 if(texts.some(v=>v.includes("RISULTATO D'ESERCIZIO")))break;
 const sd=texts.indexOf('SALDO'),dd=texts.indexOf('DARE'),aa=texts.indexOf('AVERE');if(sd>=0&&dd>=0&&aa>=0){cols={saldo:sd,debit:dd,credit:aa};headers++;continue;}
 if(!cols)continue;
 if(texts.includes('COSTI')||texts.includes('RICAVI')){section=texts.includes('COSTI')?'cost':'revenue';totals[section]=number(row[cols.saldo]);continue;}
 if(!section)continue;
 if(texts.some(v=>/^(TOTALE|UTILE|PERDITA)\b/.test(v)))continue;
 const ci=row.findIndex((v,i)=>i<cols.debit&&/^\d{4,}(?:[.\/-]\d+)*$/.test(String(v??'').trim()));if(ci<0)continue;
 const code=String(row[ci]).trim(),description=row.slice(ci+1,cols.debit).find(v=>typeof v==='string'&&v.trim());if(!description){issues.push('Descrizione mancante alla riga '+(r+1));continue;}
 const debit=number(row[cols.debit]),credit=number(row[cols.credit]),value=number(row[cols.saldo]);const address=X.utils.encode_cell({r,c:cols.saldo});
 if(value==null){issues.push('Saldo non numerico: '+address);continue;}
 const cell=ws[address];if(cell?.f)issues.push('Saldo con formula: verificare ricalcolo Excel in '+address);
 if(debit!=null&&credit!=null&&Math.abs(round((section==='cost'?debit-credit:credit-debit)-value))>.02)issues.push('Dare/Avere non riconciliati: '+address);
 if(accounts.some(a=>a.code===code))issues.push('Conto duplicato: '+code);
 accounts.push({code,description:description.trim(),side:section,value:round(value),debit,credit,cell:address,row:r+1});
 }
 if(!accounts.length){rejected.push({file,sheet,error:'Nessun conto analitico riconosciuto (richiesti Dare, Avere, Saldo e sezioni COSTI/RICAVI).'});continue;}
 const checks=['cost','revenue'].map(side=>{const actual=round(accounts.filter(a=>a.side===side).reduce((n,a)=>n+a.value,0)),expected=totals[side];return {side,actual,expected,delta:expected==null?null:round(actual-expected)};});
 checks.forEach(c=>{if(c.expected==null)issues.push('Totale '+c.side+' non riconosciuto');else if(Math.abs(c.delta)>.02)issues.push('Totale '+c.side+' non riconciliato: '+c.delta);});
 snapshots.push({id:file+'::'+sheet,file,sheet,entity:entity||'Cliente da identificare',taxId:(entityCell?.match(/Partita IVA\s+(\d+)/i)||[])[1]||'',start,end,accounts,checks,issues,enabled:issues.length===0,kind:'cumulative',originalStart:start,originalEnd:end,dateConfirmed:false});
 }catch(e){rejected.push({file,sheet,error:e.message});}}return {snapshots,rejected};}
function validatePeriod(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s.start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(s.end||''))return false;return dates(s.start.split('-').reverse().join('/'))[0]===s.start&&dates(s.end.split('-').reverse().join('/'))[0]===s.end&&s.start<=s.end;}
const nextDay=s=>new Date(Date.parse(s+'T00:00:00Z')+86400000).toISOString().slice(0,10);
function series(snapshots,entity,mode='movement'){
 const ss=snapshots.filter(s=>s.enabled&&s.entity===entity).sort((a,b)=>a.end.localeCompare(b.end));const errors=[];
 if(!ss.length)return {periods:[],errors:['Nessuna situazione abilitata per questo cliente.']};
 for(let i=0;i<ss.length;i++){const s=ss[i],p=ss[i-1];if(!validatePeriod(s))errors.push('Periodo non valido: '+s.sheet);if(s.issues.some(x=>!/Data del foglio/.test(x)))errors.push('Controlli sorgente non superati: '+s.sheet);if(s.issues.some(x=>/Data del foglio/.test(x))&&!s.dateConfirmed)errors.push('Confermare le date: '+s.sheet);if(p&&s.end===p.end)errors.push('Due situazioni con stessa data finale: '+s.end);if(p&&(s.kind!==p.kind||(s.kind==='cumulative'&&s.start!==p.start)))errors.push('Serie non omogenea: date iniziali o tipi diversi');if(p&&s.kind==='period'&&s.start<=p.end)errors.push('Periodi sovrapposti');}
 if(errors.length)return {periods:[],errors};
 const all=new Map();ss.forEach(s=>s.accounts.forEach(a=>all.set(a.code,a)));let previous=null;const periods=ss.map(s=>{const map=new Map(s.accounts.map(a=>[a.code,a]));let start=s.start;
 if(mode==='movement'&&s.kind==='cumulative'&&previous)start=nextDay(previous.end);
 const values=[...all.values()].map(a=>{const curr=map.get(a.code);let v=curr?.value||0;if(mode==='movement'&&s.kind==='cumulative'&&previous)v-=previous.accounts.find(x=>x.code===a.code)?.value||0;return {...a,value:round(v),cell:curr?.cell||null,absent:!curr};});
 const p={snapshot:s,start,end:s.end,accounts:values,label:start+' → '+s.end};previous=s;return p;});return {periods,errors};
}
function aggregate(period,mappings={}){const groups=Object.fromEntries(Object.keys(categories).map(c=>[c,0]));let unmapped=0,pending=0;const behaviors={Fisso:0,Variabile:0,Misto:0,'Da valutare':0};let costs=0,revenue=0;
 period.accounts.forEach(a=>{const m=mappings[a.code]||propose(a);if(a.side==='cost')costs+=a.value;else revenue+=a.value;if(a.value&&!m.confirmed)pending++;if(m.cee==='NC'||!categories[m.cee]){unmapped+=Math.abs(a.value);groups.NC+=a.side==='cost'?-a.value:a.value;}else{const positive=/^(A|C15|C16|D18)/.test(m.cee);groups[m.cee]+=(positive?(a.side==='revenue'?1:-1):(a.side==='cost'?1:-1))*a.value;}
 if(a.side==='cost'&&m.cee.startsWith('B')){if(m.behavior==='Misto'&&m.variableShare!=null){behaviors.Variabile+=a.value*m.variableShare/100;behaviors.Fisso+=a.value*(1-m.variableShare/100);}else behaviors[m.behavior in behaviors?m.behavior:'Da valutare']+=a.value;}});
 Object.keys(groups).forEach(k=>groups[k]=round(groups[k]));Object.keys(behaviors).forEach(k=>behaviors[k]=round(behaviors[k]));
 const vp=round(Object.keys(groups).filter(k=>k.startsWith('A')).reduce((n,k)=>n+groups[k],0)),productionCosts=round(Object.keys(groups).filter(k=>k.startsWith('B')).reduce((n,k)=>n+groups[k],0));const ebit=round(vp-productionCosts),ebitda=round(ebit+groups.B10a+groups.B10b);
 return {groups,vp:unmapped?null:vp,ebit:unmapped?null:ebit,ebitda:unmapped?null:ebitda,costs:round(costs),revenue:round(revenue),profit:round(revenue-costs),productionCosts,behaviors,unmapped,pending};
}
const empiricalDefaults={fixedTolerance:10,absoluteTolerance:10,ratioTolerance:15,minMonths:3,minActivityVariation:10,minCorrelation:.7,minMixedR2:.8,driver:'turnover'};
function empiricalSettings(input={}){const s={...empiricalDefaults};for(const [k,min,max] of [['fixedTolerance',0,100],['absoluteTolerance',0,10000],['ratioTolerance',0,100],['minMonths',3,24]])if(Number.isFinite(+input[k]))s[k]=Math.min(max,Math.max(min,+input[k]));s.minMonths=Math.ceil(s.minMonths);if(input.driver==='vp')s.driver='vp';return s;}
function fullMonth(p){return /^\d{4}-\d{2}-01$/.test(p.start)&&p.start.slice(0,7)===p.end.slice(0,7)&&nextDay(p.end).endsWith('-01');}
function totalPeriod(movements){if(!movements.length)return null;const accounts=new Map();for(const p of movements)for(const a of p.accounts){const old=accounts.get(a.code);accounts.set(a.code,{...a,value:round((old?.value||0)+a.value)});}return {start:movements[0].start,end:movements.at(-1).end,accounts:[...accounts.values()],snapshot:movements.at(-1).snapshot,label:'Totale periodo'};}
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const sd=a=>Math.sqrt(mean(a.map(v=>(v-mean(a))**2)));
const cv=a=>Math.abs(mean(a))>1e-10?sd(a)/Math.abs(mean(a)):null;
function empirical(movements,mappings={},input={}){const settings=empiricalSettings(input),months=movements.filter(fullMonth),stats=months.map(p=>aggregate(p,mappings));
 const activity=stats.map(r=>r.unmapped?null:settings.driver==='vp'?r.vp:r.groups.A1),accounts=new Map();movements.forEach(p=>p.accounts.forEach(a=>accounts.set(a.code,a)));const byCode={};
 for(const a of accounts.values()){if(a.side!=='cost')continue;const values=months.map(p=>p.accounts.find(x=>x.code===a.code)?.value||0),n=values.length;
 const r={behavior:'Da valutare',variableShare:null,n,values,activity,reason:'Mesi completi insufficienti',mean:n?mean(values):null,cv:n?cv(values):null,ratioCv:null,correlation:null,r2:null,maxDeviation:null,source:'empirical'};byCode[a.code]=r;
 if(n<settings.minMonths)continue;
 if(values.some(v=>v<0)){r.reason='Storni o saldi negativi: verificare la competenza';continue;}
 if(values.every(v=>v===0)){r.reason='Nessun costo nei mesi completi';continue;}
 const sorted=[...values].sort((a,b)=>a-b),median=n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
 r.median=median;r.maxDeviation=Math.max(...values.map(v=>Math.abs(v-median)));r.tolerance=Math.max(settings.absoluteTolerance,median*settings.fixedTolerance/100);
 if(values.every(v=>v>0)&&r.maxDeviation<=r.tolerance){r.behavior='Fisso';r.variableShare=0;r.reason='Importo mensile quasi costante entro la tolleranza';continue;}
 if(activity.some(x=>x==null||x<=0)){r.reason='Volume di attività non disponibile o non positivo';continue;}
 r.activityCv=cv(activity);if(r.activityCv<settings.minActivityVariation/100){r.reason='Volume poco variabile: relazione non identificabile';continue;}
 const mx=mean(activity),my=mean(values),sxx=activity.reduce((s,x)=>s+(x-mx)**2,0),syy=values.reduce((s,y)=>s+(y-my)**2,0),sxy=activity.reduce((s,x,i)=>s+(x-mx)*(values[i]-my),0);
 r.correlation=syy>0?sxy/Math.sqrt(sxx*syy):0;r.slope=sxy/sxx;r.intercept=my-r.slope*mx;r.r2=r.correlation**2;r.ratioCv=cv(values.map((y,i)=>y/activity[i]));
 if(n>=Math.max(6,settings.minMonths)&&values.every(v=>v>0)&&r.intercept>Math.max(settings.absoluteTolerance,my*settings.fixedTolerance/100)&&r.slope>0&&r.r2>=settings.minMixedR2){r.behavior='Misto';r.variableShare=round(100*r.slope*mx/my);r.reason='Componente fissa significativa e variabile da regressione lineare';}
 else if(values.every(v=>v>0)&&r.ratioCv!=null&&r.ratioCv<=settings.ratioTolerance/100&&r.correlation>=settings.minCorrelation){r.behavior='Variabile';r.variableShare=100;r.reason='Incidenza stabile e relazione positiva con il volume';}
 else r.reason=values.some(v=>v===0)?'Registrazioni intermittenti: verificare competenza e periodicità':'Nessuna relazione sufficientemente stabile';
 }
 return {byCode,months,settings,excluded:movements.length-months.length};
}
function effectiveMappings(movements,saved={},input={}){const evidence=empirical(movements,saved,input),mappings={};const all=new Map();movements.forEach(p=>p.accounts.forEach(a=>all.set(a.code,a)));for(const a of all.values()){const old=saved[a.code],base={...propose(a),...old};const manual=old?.behaviorSource==='manual'||(!old?.behaviorSource&&old?.confirmed);const ev=evidence.byCode[a.code];if(a.side==='cost'&&!manual){base.behavior=ev?.behavior||'Da valutare';base.variableShare=ev?.variableShare??null;base.behaviorSource='empirical';}else if(manual)base.behaviorSource='manual';base.evidence=ev;mappings[a.code]=base;}return {mappings,evidence};}
function coveredMonths(movements){return movements.reduce((sum,p)=>{let d=new Date(p.start+'T00:00:00Z'),end=new Date(p.end+'T00:00:00Z'),n=0;while(d<=end){const next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)),days=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();n+=(Math.min(+next,+end+86400000)-d)/86400000/days;d=next;}return sum+n;},0);}
function breakEven(movements,mappings,options={}){const months=options.cumulative?movements:movements.filter(fullMonth),n=options.cumulative?coveredMonths(months):months.length,result={n,periods:months.map(p=>p.label),fixed:0,variable:0,unknown:0,unknownAbsolute:0,unknownCodes:[],turnover:0,otherRevenue:0,excludedTaxes:0,annual:null,errors:[],scenario:false,netAdjustments:false};
 if(options.cumulative?n<=0:n<3){result.errors.push('Periodo insufficiente per annualizzare il modello.');return result;}
 let negative=false,unmapped=false;const costTotals=new Map();for(const p of months){const r=aggregate(p,mappings);if(r.unmapped)unmapped=true;result.turnover+=r.groups.A1;result.otherRevenue+=r.revenue-r.groups.A1;
 for(const a of p.accounts){if(a.side!=='cost')continue;const m=mappings[a.code]||propose(a);if(m.cee==='T20'){result.excludedTaxes+=a.value;continue;}if(a.value<0)negative=true;costTotals.set(a.code,{...a,value:(costTotals.get(a.code)?.value||0)+a.value});}}
 for(const a of costTotals.values()){const m=mappings[a.code]||propose(a),share=m.behavior==='Fisso'?0:m.behavior==='Variabile'?1:m.behavior==='Misto'&&m.variableShare!=null?m.variableShare/100:null;if(share==null){result.unknown+=a.value;result.unknownAbsolute+=Math.abs(a.value);if(Math.abs(a.value)>.01)result.unknownCodes.push(a.code);}else{result.fixed+=a.value*(1-share);result.variable+=a.value*share;}}
 if(unmapped)result.errors.push('Completare le voci CEE prima del pareggio.');if(negative){if(options.netAdjustments===true){result.scenario=true;result.netAdjustments=true;}else result.errors.push('Presenti storni mensili: verificare competenza o attivare lo scenario sui saldi netti.');}if(result.turnover<=0)result.errors.push('Fatturato A1 non positivo.');
 const explicitShare=options.assumeUnknown===true&&Number.isFinite(options.unknownVariablePct)&&options.unknownVariablePct>=0&&options.unknownVariablePct<=100;
 if(result.unknownAbsolute>.01){if(explicitShare){result.scenario=true;result.fixed+=result.unknown*(1-options.unknownVariablePct/100);result.variable+=result.unknown*options.unknownVariablePct/100;}else result.errors.push(`${result.unknownCodes.length} conti con natura non determinata: completare la classificazione o impostare uno scenario esplicito.`);}
 if(result.fixed<0||result.variable<0)result.errors.push('Componenti di costo nette negative: il modello lineare non è applicabile.');
 result.fixedAnnual=round(result.fixed/n*12);result.variableRatio=result.turnover>0?result.variable/result.turnover:null;result.otherAnnual=options.includeOther===true?round(result.otherRevenue/n*12):0;result.turnoverAnnual=round(result.turnover/n*12);result.contribution=result.variableRatio==null?null:1-result.variableRatio;
 if(result.contribution!=null&&result.contribution<=0)result.errors.push('Margine di contribuzione non positivo: nessun pareggio con questo modello.');
 if(!result.errors.length)result.annual=round(Math.max(0,(result.fixedAnnual-result.otherAnnual)/result.contribution));return result;
}
function revenueComposition(period,mappings={}){const r=aggregate(period,mappings),groups={};for(const a of period.accounts){if(a.side!=='cost')continue;const key=(mappings[a.code]||propose(a)).cee;groups[key]=(groups[key]||0)+a.value;}const entries=Object.entries(groups).filter(([,v])=>v!==0).map(([key,value])=>({key,label:key+' · '+categories[key],value:round(value),percent:r.revenue>0?value/r.revenue*100:null}));return {entries,revenue:r.revenue,costs:r.costs,profit:r.profit,totalPercent:r.revenue>0?r.costs/r.revenue*100:null,canDraw:r.revenue>0&&entries.every(e=>e.value>=0)};}
return {categories,round,number,dates,propose,parseWorkbook,series,aggregate,validatePeriod,empiricalDefaults,empiricalSettings,fullMonth,totalPeriod,empirical,effectiveMappings,breakEven,revenueComposition,coveredMonths};
});
