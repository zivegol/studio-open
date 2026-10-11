import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {PortalDriver,validateTaxCode} from './portal-driver.mjs';
import {fillEntratelCredentials} from './portal-login.mjs';

const secret=(await readFile('/run/secrets/key','utf8')).trim();
if(secret.length<48)throw new Error('Connector key missing');
const sessions=new Map();
const commandLocks=new Set();
const MAX_BYTES=20*1024*1024;
let browserPromise;
const browser=()=>browserPromise??=(chromium.launch({headless:true}).then(b=>{
  b.on('disconnected', ()=>{ browserPromise=null; });
  return b;
}).catch(e=>{browserPromise=null;throw e;}));

const circuitBreaker = {
  tripped: false,
  reason: null,
  timestamp: 0
};

class PublicError extends Error {}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function authorized(value){const supplied=Buffer.from(String(value||'')),expected=Buffer.from(secret);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
async function body(req){let content='',size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw new PublicError('Richiesta troppo grande.');content+=chunk.toString('utf8');}return JSON.parse(content||'{}');}
async function newSession(id){
  if(sessions.size>=8)throw new PublicError('Tutte le sessioni del connettore sono occupate.');
  const context=await(await browser()).newContext({acceptDownloads:true,locale:'it-IT',timezoneId:'Europe/Rome'});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  const s={context,page,driver:new PortalDriver(page),jobs:new Map(),busy:false,authenticated:false,last:Date.now()};
  sessions.set(id,s);return s;
}
async function destroy(id){const s=sessions.get(id);sessions.delete(id);if(s)await s.context.close().catch(()=>{});}
async function login(s,c){
  if(circuitBreaker.tripped){
    const d=new Date(circuitBreaker.timestamp).toLocaleTimeString('it-IT');
    throw new PublicError(`CIRCUIT BREAKER ATTIVO: Il connettore ha bloccato il login automatico per proteggere l'utenza dello studio dal blocco del PIN Entratel.\nMotivo del blocco (${d}): ${circuitBreaker.reason}.\nVerificare l'accesso manualmente sul sito dell'Agenzia delle Entrate e, se sbloccato, ripristinare il connettore.`);
  }
  if(!c||!['username','password','pin'].every(k=>typeof c[k]==='string'&&c[k].length>0&&c[k].length<=256))throw new PublicError('Inserire utente Entratel, password e PIN.');
  const p=s.page;s.authenticated=false;let phase='page';
  try{
    await p.goto('https://telematici.agenziaentrate.gov.it/');
    await p.getByRole('tab',{name:'Fisconline/Entratel',exact:true}).click();
    phase='fields';
    const submit=await fillEntratelCredentials(p,c);
    phase='submit';
    await submit.click();
    phase='confirmation';

    // Race between confirmation link and explicit error message detection
    const successPromise = p.getByRole('link',{name:/Cambia Utenza/i}).waitFor({state:'visible',timeout:25000}).then(()=>'ok');
    const errorPromise = (async()=>{
      for(let i=0; i<30; i++){
        await p.waitForTimeout(600);
        try{
          const text = await p.locator('body').innerText();
          if(/codice pin non corretto|password non corretta|credenziali non corrette|credenziali errate|utenza bloccata|tentativi esauriti|codice di sicurezza errato/i.test(text)){
            const match = text.match(/(?:codice pin non corretto|password non corretta|credenziali non corrette|credenziali errate|utenza bloccata|tentativi esauriti|codice di sicurezza errato)[^.\n]*/i);
            return match ? match[0].trim() : 'Credenziali o PIN non corretti';
          }
          if(/captcha|verifica di sicurezza/i.test(text) && !text.includes('Cambia Utenza')){
            return 'Richiesta verifica di sicurezza o CAPTCHA sul portale';
          }
        }catch{}
      }
      return null;
    })();

    const res = await Promise.race([successPromise, errorPromise]);
    if(res !== 'ok' && res){
      circuitBreaker.tripped = true;
      circuitBreaker.reason = res;
      circuitBreaker.timestamp = Date.now();
      throw new PublicError(`ACCESSO ENTRATEL RIFIUTATO: ${res}. Il connettore è stato bloccato automaticamente per salvaguardare il PIN dello studio.`);
    }

    await p.getByRole('link',{name:/Cambia Utenza/i}).waitFor({state:'visible',timeout:10000});
    if(new URL(p.url()).hostname!=='portale.agenziaentrate.gov.it')throw new Error('Wrong destination');
    s.authenticated=true;return {connected:true};
  }catch(err){
    if(err instanceof PublicError) throw err;
    const errors={page:'Il connettore non riesce ad aprire il modulo Entratel. Le credenziali non sono state inviate.',fields:'Il connettore non riesce a compilare il modulo Entratel. Le credenziali non sono state inviate.',submit:'Invio del modulo Entratel non confermato.',confirmation:'Entratel non ha confermato l’accesso dopo l’invio. Verificare le credenziali o eventuali richieste aggiuntive sul portale.'};
    throw new PublicError(errors[phase] || err.message);
  }finally{c.username='';c.password='';c.pin='';}
}
async function fileResult(result){
  let data;
  const dl = result?.download || (typeof result?.createReadStream === 'function' ? result : null);
  if(result?.buffer){
    data = Buffer.isBuffer(result.buffer) ? result.buffer : Buffer.from(result.buffer);
  }else if(dl){
    const stream=await dl.createReadStream();
    if(!stream)throw new PublicError('File non disponibile dopo il download.');
    const chunks=[];let size=0;
    try{for await(const part of stream){size+=part.length;if(size>MAX_BYTES)throw new PublicError('Documento superiore al limite di 20 MB.');chunks.push(part);}}
    finally{await dl.delete().catch(()=>{});}
    data=Buffer.concat(chunks);
  }else{
    throw new PublicError('Documento non disponibile dal portale.');
  }
  if(data.subarray(0,5).toString()!=='%PDF-')throw new PublicError('Il portale non ha restituito un PDF valido. Nessun documento archiviato.');
  return {file:{content:data.toString('base64'),sha256:createHash('sha256').update(data).digest('hex'),extension:'pdf',mime:'application/pdf'},metadata:result.metadata};
}
function publicMessage(e){
  if(e instanceof PublicError || e?.isPublic || e?.name === 'PublicError')return e.message;
  const msg=String(e?.message||'');
  const allowed=['Codice fiscale non valido.','Anno non valido.','Annualità F24 non disponibile.','Utenza dello studio non disponibile per questo operatore.','Utenza di lavoro diversa da quella richiesta.','Cliente attivo diverso da quello richiesto.','Quietanza non disponibile o protocollo ambiguo.','Protocollo quietanza mancante.','Selezione cliente non confermata: verificare delega o messaggio del portale.','Accesso Entratel richiesto: autenticarsi nel browser del connettore.'];
  return allowed.includes(msg)?msg:e?.portalPhase?'Recupero interrotto durante: '+e.portalPhase+'. Il passaggio sul portale richiede verifica.':'Operazione non completata sul portale. La sessione potrebbe essere scaduta o la pagina potrebbe essere cambiata. Riconnetti Entratel e riprova.';
}
async function dispatch(s,op,input){
  if(op==='login')return login(s,input.credentials);
  if(!s.authenticated)throw new PublicError('Collega Entratel prima di recuperare i documenti.');
  const args={studio:validateTaxCode(input.studio),client:validateTaxCode(input.client),model:input.model,year:input.year,protocol:input.protocol,direction:input.direction||'ricevute'};
  console.log(`[CONNECTOR COMMAND] op: ${op} | client: ${args.client} | studio: ${args.studio}`);
  if(op==='document-types')return s.driver.listDocumentTypes(args);
  if(op==='document-years')return s.driver.listDocumentYears(args);
  if(op==='f24-list'){
    const data=await s.driver.listF24(args);
    return {...data,records:data.records.map(({quietanzaUrl,...row})=>({...row,downloadable:Boolean(quietanzaUrl)}))};
  }
  if(op==='f24-download')return fileResult(await s.driver.downloadF24(args));
  if(op==='declaration-download')return fileResult(await s.driver.downloadCurrentDeclaration(args));
  if(op==='invoices-open')return await s.driver.openInvoices(args);
  throw new PublicError('Operazione non supportata.');
}
const server=http.createServer(async(req,res)=>{
  let lockedSid;
  try{
    if(req.url==='/health'&&req.method==='GET')return json(res,200,{ok:true});
    if(!authorized(req.headers['x-connector-key']))return json(res,403,{error:'Accesso negato.'});
    const sid=String(req.headers['x-connector-session']||'');
    if(!/^[a-f0-9]{64}$/.test(sid))return json(res,400,{error:'Sessione non valida.'});
    if(req.method!=='POST'||req.url!=='/command')return json(res,404,{error:'Operazione non disponibile.'});
    const input=await body(req),op=input.op;
    let s=sessions.get(sid);if(s)s.last=Date.now();
    if(op==='circuit-status')return json(res,200,{tripped:circuitBreaker.tripped,reason:circuitBreaker.reason,timestamp:circuitBreaker.timestamp});
    if(op==='circuit-reset'){circuitBreaker.tripped=false;circuitBreaker.reason=null;circuitBreaker.timestamp=0;return json(res,200,{ok:true,message:'Circuit breaker ripristinato.'});}
    if(op==='status')return json(res,200,{connected:Boolean(s?.authenticated),busy:Boolean(s?.busy),circuitTripped:circuitBreaker.tripped,circuitReason:circuitBreaker.reason,pending:s?[...s.jobs.values()].map(j=>({id:j.id,state:j.state})):[]});
    if(op==='job'){
      const job=s?.jobs.get(input.id);if(!job)return json(res,404,{error:'Operazione scaduta o non disponibile.'});
      return json(res,200,job);
    }
    if(op==='ack'){s?.jobs.delete(input.id);return json(res,200,{ok:true});}
    if(!['login','logout','f24-list','f24-download','declaration-download','document-types','document-years','invoices-open'].includes(op))return json(res,400,{error:'Operazione non supportata.'});
    if(commandLocks.has(sid))return json(res,409,{error:'Attendi il completamento dell’operazione in corso.'});
    commandLocks.add(sid);lockedSid=sid;
    if(s?.busy)return json(res,409,{error:'Attendi il completamento dell’operazione in corso.'});
    if(op==='logout'){await destroy(sid);return json(res,200,{connected:false});}
    if(op==='login'&&s){await destroy(sid);s=null;}
    if(!s){if(op!=='login')return json(res,401,{error:'Collega Entratel per continuare.'});s=await newSession(sid);}
    if(s.jobs.size>=10)return json(res,409,{error:'Troppe operazioni non ritirate. Disconnetti e riconnetti Entratel.'});
    const id=randomUUID(),job={id,state:'running'};s.jobs.set(id,job);s.busy=true;
    json(res,202,{id,state:'running'});
    const deadline=setTimeout(()=>{s.authenticated=false;s.context.close().catch(()=>{});},180000);
    (async()=>{
      try{const result=await dispatch(s,op,input);job.result=result;job.state='complete';}
      catch(e){
        console.error('[JOB ERROR]:', e);
        if(e.sessionExpired||e.message==='Accesso Entratel richiesto: autenticarsi nel browser del connettore.')s.authenticated=false;
        job.state='failed';
        job.error=publicMessage(e);
        job.connected=s.authenticated;
      }
      finally{
        clearTimeout(deadline);
        if(input.credentials){input.credentials.username='';input.credentials.password='';input.credentials.pin='';}
        s.busy=false;s.last=Date.now();
        if(s.context){
          try{
            const pages=s.context.pages();
            for(let i=1;i<pages.length;i++){
              await pages[i].close().catch(()=>{});
            }
          }catch{}
        }
      }
    })();
  }catch(e){json(res,400,{error:e instanceof PublicError?e.message:'Richiesta non valida o connettore non disponibile.'});}
  finally{if(lockedSid)commandLocks.delete(lockedSid);}
});
server.requestTimeout=30000;
server.listen(8787,'0.0.0.0',()=>console.log('Agenzia Entrate connector ready'));
setInterval(()=>{for(const [id,s] of sessions)if(!s.busy&&Date.now()-s.last>15*60000)destroy(id);},60000).unref();
process.on('SIGTERM',async()=>{server.close();await Promise.all([...sessions.keys()].map(destroy));if(browserPromise)await(await browserPromise).close();process.exit(0);});
