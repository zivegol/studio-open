/**
 * Driver per un worker Playwright dedicato. Non esporta cookie o credenziali.
 * Gestione sessione Entratel, Cassetto Fiscale delegato e Fatture & Corrispettivi.
 * Una sola istanza per BrowserContext; non condividere il contesto fra operatori.
 */
const HOME='https://portale.agenziaentrate.gov.it/PortaleWeb/home';
const SWITCH='https://portale.agenziaentrate.gov.it/PortaleWeb/cambiautenza';
const CASSETTO='https://cassetto.agenziaentrate.gov.it/CassHomeWeb/home';
const INVOICE_WIZARD='https://ivaservizi.agenziaentrate.gov.it/instr/InstradamentofcWeb/wizard';
const INVOICE_HOME='https://ivaservizi.agenziaentrate.gov.it/instr/InstradamentofcWeb/home';

export class PublicError extends Error {
  constructor(message){
    super(message);
    this.name='PublicError';
    this.isPublic=true;
  }
}

export function validateTaxCode(value){
  const code=String(value||'').trim().toUpperCase();
  if(!/^(?:\d{11}|[A-Z0-9]{16})$/.test(code))throw new Error('Codice fiscale non valido.');
  return code;
}

export function assertContext(text,studio,client){
  studio=validateTaxCode(studio);client=validateTaxCode(client);
  const normalized=String(text).replace(/\s+/g,' ');
  const work=normalized.match(/Utenza di lavoro\s*:\s*(.*?)\s*[-–]\s*000\b/i);
  if(!work||!new RegExp('(?:^|\\s)'+studio+'(?:\\s|$)').test(work[1]))throw new Error('Utenza di lavoro diversa da quella richiesta.');
  const selected=normalized.match(/(?:sei nel cassetto\s+delegato di|Codice fiscale(?:\s+del contribuente)?|Contribuente|Cassetto di)\s*:\s*([A-Z0-9]+)/i);
  if(selected){
    if(selected[1].toUpperCase()!==client)throw new Error('Cliente attivo diverso da quello richiesto.');
  }else if(!normalized.includes(client)){
    throw new Error('Cliente attivo diverso da quello richiesto.');
  }
}

export function validateQuietanzaUrl(value){
  const url=new URL(value);
  if(url.origin!=='https://cassetto.agenziaentrate.gov.it'||url.pathname!=='/cassfisc-web/CassettoFiscaleServlet')throw new Error('Collegamento quietanza non riconosciuto.');
  return url.href;
}

export function assertInvoiceSummary(text,studio,client){
  studio=validateTaxCode(studio);client=validateTaxCode(client);
  const normalized=String(text).replace(/\s+/g,' ');
  const work=normalized.match(/Codice fiscale del soggetto che ti ha incaricato\s*:\s*([A-Z0-9]+)/i);
  const subject=normalized.match(/Codice fiscale\s*:\s*([A-Z0-9]+)/i);
  if(work?.[1]!==studio||subject?.[1]!==client||!/Delegato per singolo soggetto/i.test(normalized))throw new Error('Riepilogo delega fatture non corrispondente a studio e cliente richiesti.');
}

export function assertInvoiceContext(text,client,{home=false}={}){
  client=validateTaxCode(client);
  const normalized=String(text).replace(/\s+/g,' ');
  if(home){
    const active=normalized.match(/stai operando su:\s*Partita IVA\s+(\d{11})\s+di\s+.*?\(\s*([A-Z0-9]+)\s*\)\s+in qualità di\s+([A-Z]+)/i);
    if(!active||(active[2].toUpperCase()!==client&&active[1]!==client)||active[3].toUpperCase()!=='DELEGATO')throw new Error('Fatture: cliente delegante non confermato dal portale.');
  }else{
    const active=normalized.match(/Per conto di\s*:\s*([A-Z0-9]+)/i);
    if(active?.[1].toUpperCase()!==client)throw new Error('Fatture: utenza attiva diversa dal cliente richiesto.');
  }
}

export async function closeDeleganteDialog(page){
  try{
    const close=page.locator('button, a, [role="button"]').filter({hasText:/Chiudi\s+finestra\s*delegato?/i}).first();
    if(await close.count()>0&&await close.isVisible().catch(()=>false)){
      await close.click({timeout:2500}).catch(()=>{});
      await page.waitForTimeout(350);
    }
    const dialog=page.locator('[role="dialog"]').first();
    if(await dialog.count()>0&&await dialog.isVisible().catch(()=>false)){
      const text=(await dialog.innerText().catch(()=>'')).trim();
      throw new Error(`Finestra modale ancora aperta: ${text || 'messaggio inatteso'}`);
    }
  }catch(e){
    if(/ancora aperta/i.test(e?.message||''))throw e;
  }
}

export async function clickAndFollow(page, locator) {
  const context = page.context();
  const initialPages = context.pages();

  const pagePromise = context.waitForEvent('page', { timeout: 7000 }).catch(() => null);
  const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);

  await locator.click();

  const newPage = await pagePromise;
  if (newPage) {
    await newPage.waitForLoadState('domcontentloaded').catch(() => {});
    return newPage;
  }

  await navPromise;
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const currentPages = context.pages();
  if (currentPages.length > initialPages.length) {
    const lastPage = currentPages[currentPages.length - 1];
    await lastPage.waitForLoadState('domcontentloaded').catch(() => {});
    return lastPage;
  }

  return page;
}

export class PortalDriver {
  #page; #busy=false; #phase='apertura del servizio';
  constructor(page){this.#page=page;}

  async #exclusive(action){
    if(this.#busy)throw new Error('Operazione già in corso: attendere prima di cambiare cliente.');
    this.#busy=true;
    try{
      return await action();
    }catch(error){
      console.error(`[PORTAL EXCLUSIVE ERROR] Phase: ${this.#phase} | URL: ${this.#page.url?.()}`);
      console.error(error);
      try {
        const title = await this.#page.title();
        const text = await this.#page.locator('body').innerText();
        console.error(`[PORTAL PAGE TITLE]: ${title}`);
        console.error(`[PORTAL PAGE TEXT SNIPPET]: ${text.slice(0, 1500).replace(/\s+/g, ' ')}`);
        const links = await this.#page.locator('a, button').evaluateAll(els => els.map(e => (e.innerText || e.value || '').trim()).filter(Boolean));
        console.error(`[PORTAL VISIBLE LINKS]: ${JSON.stringify(links.slice(0, 40))}`);
      } catch (logErr) {
        console.error('[PORTAL LOGGING FAILED]:', logErr);
      }
      if(this.#page.url?.().startsWith('https://iampe.agenziaentrate.gov.it/')){
        const expired=new Error('Accesso Entratel richiesto: autenticarsi nel browser del connettore.');
        expired.sessionExpired=true;
        throw expired;
      }
      error.portalPhase=this.#phase;
      throw error;
    }finally{
      this.#busy=false;
    }
  }

  async #body(){return this.#page.locator('body').innerText();}
  async #verify(studio,client){assertContext(await this.#body(),studio,client);}

  openInvoices({studio,client,direction='ricevute'}){
    return this.#exclusive(async()=>{
      studio=validateTaxCode(studio);client=validateTaxCode(client);
      if(!['ricevute','emesse'].includes(direction))throw new Error('Direzione fatture non valida.');
      const p=this.#page;
      await p.goto(INVOICE_WIZARD);
      await p.locator('#tipoutenza-1').check({timeout:15000}).catch(()=>{throw new Error('Accesso Entratel richiesto per Fatture e Corrispettivi.');});
      await p.getByRole('button',{name:/^Procedi/}).click();
      const select=p.locator('#incaricante');
      await select.waitFor({state:'visible'});
      const options=await select.locator('option').evaluateAll(nodes=>nodes.map(n=>({label:n.textContent.trim(),value:n.value})));
      const option=options.find(o=>o.label.replace(/\s/g,'')===studio+'-000');
      if(!option)throw new Error('Studio non disponibile nella scelta incaricante.');
      await select.selectOption(option.value);
      const delegated=p.getByRole('radio',{name:'delegato per singolo soggetto',exact:true});
      await delegated.waitFor({state:'visible',timeout:15000});
      await delegated.check();
      await p.getByLabel('Codice fiscale del soggetto per cui operare:',{exact:true}).fill(client);
      await p.getByRole('button',{name:/^Procedi/}).click();
      await p.getByRole('button',{name:'Conferma',exact:true}).waitFor({state:'visible'});
      assertInvoiceSummary(await p.locator('#wizard-vertical-1-step-3').innerText(),studio,client);
      await p.getByRole('button',{name:'Conferma',exact:true}).click();
      await p.waitForURL(INVOICE_HOME);
      await p.getByText(/stai operando su:/).waitFor({state:'visible'});
      assertInvoiceContext(await this.#body(),client,{home:true});
      await p.getByRole('link',{name:/Fatture elettroniche e altri dati IVA/}).click();
      const list=p.getByRole('link',{name:'Le tue fatture '+direction,exact:true});
      await list.waitFor({state:'visible'});
      assertInvoiceContext(await this.#body(),client);
      await list.click();
      await p.getByRole('heading',{name:'Le tue fatture '+direction,exact:true}).waitFor({state:'visible'});
      assertInvoiceContext(await this.#body(),client);
      return {studio,client,direction,status:'search_ready'};
    });
  }

  async #select(studio,client){
    let p=this.#page;
    if(p.isClosed()){
      const pages=p.context().pages();
      this.#page=pages[0]||await p.context().newPage();
      p=this.#page;
    }
    studio=validateTaxCode(studio);client=validateTaxCode(client);

    this.#phase='verifica della sessione Entratel';
    await p.goto(HOME);
    await p.getByRole('link',{name:/Cambia Utenza/i}).waitFor({state:'visible',timeout:15000}).catch(()=>{throw new Error('Accesso Entratel richiesto: autenticarsi nel browser del connettore.');});

    this.#phase='scelta dell’utenza dello studio';
    await p.goto(SWITCH);
    const select=p.locator('#utenza');
    await select.waitFor({state:'visible'});
    const options=await select.locator('option').evaluateAll(nodes=>nodes.map(n=>({label:n.textContent.trim(),value:n.value})));
    const option=options.find(o=>o.label.replace(/\s/g,'')===studio+'-000');
    if(!option)throw new Error('Utenza dello studio non disponibile per questo operatore.');
    await select.selectOption(option.value);
    await p.getByRole('button',{name:'Conferma',exact:true}).click();
    await p.waitForURL(HOME);

    this.#phase='apertura del Cassetto fiscale';
    await p.goto(CASSETTO);
    await p.waitForLoadState('domcontentloaded').catch(()=>{});

    this.#phase='scelta del contribuente delegante';
    await closeDeleganteDialog(p).catch(()=>{});
    const currentBody=await this.#body().catch(()=>'');
    const clientRegex=new RegExp('sei nel cassetto\\s+delegato di:\\s*'+client,'i');

    if(clientRegex.test(currentBody)){
      console.log(`[CONNECTOR] Già nel cassetto delegato di ${client}`);
      await this.#verify(studio,client);
    }else{
      const changeBtn=p.locator('button, a, [role="button"]').filter({hasText:/Cassetto del contribuente delegante|Cambia contribuente delegante/i}).first();
      await changeBtn.waitFor({state:'visible',timeout:10000});
      await changeBtn.click();

      const cfInput=p.getByLabel(/Codice fiscale del cliente:/i).or(p.locator('input[name*="cliente" i], input[name*="cf" i], #cf, #codiceFiscale')).first();
      await cfInput.waitFor({state:'visible',timeout:10000});
      await cfInput.fill(client);

      const vaiBtn=p.getByRole('button',{name:/^Vai$/i}).or(p.locator('input[value="Vai"], button:has-text("Vai")')).first();
      await vaiBtn.click();

      await p.waitForTimeout(2000);

      // Check for error messages in modal or page
      const modal = p.locator('div[role="dialog"], .modal, #modal, div:has(button:has-text("Chiudi finestra delegato")), div:has(a:has-text("Chiudi finestra delegato"))').first();
      const modalVisible = await modal.isVisible().catch(() => false);
      let modalText = '';
      if (modalVisible) {
        modalText = (await modal.innerText().catch(() => '')).trim();
        console.log(`[CONNECTOR] Modal content after submit for ${client}: ${modalText.replace(/\s+/g, ' ')}`);
        if (/non risulta|non esiste|non attiva|revocata|non presente|errore|attenzione|inesistente|non autorizzato|non delegante/i.test(modalText)) {
          await closeDeleganteDialog(p).catch(() => {});
          const cleanErr = modalText.replace(/\s+/g, ' ').replace(/Chiudi\s+finestra\s*delegato?/gi, '').trim();
          const err = new PublicError(`Delega Cassetto Fiscale non attiva per ${client}: ${cleanErr || 'soggetto non presente tra i deleganti dello studio'}`);
          err.isPublic = true;
          throw err;
        }
      }

      // Close dialog so main page is visible
      await closeDeleganteDialog(p).catch(()=>{});

      // Wait for confirmation on main page
      const confirmed=await p.getByText(clientRegex).waitFor({state:'visible',timeout:8000}).then(()=>true).catch(()=>false);
      if(!confirmed){
        await closeDeleganteDialog(p).catch(()=>{});
        const afterBody=await this.#body().catch(()=>'');
        if(!clientRegex.test(afterBody)){
          const errMatch=afterBody.match(/(?:Attenzione|Errore|Messaggio)[:\s]+([^.\n\r]+)/i);
          const errDetail=errMatch?errMatch[1].trim():(modalText ? modalText.replace(/\s+/g, ' ').replace(/Chiudi\s+finestra\s*delegato?/gi, '').trim() : `per il codice fiscale ${client} non risulta una delega attiva nel Cassetto Fiscale dello studio.`);
          const err=new PublicError(`Selezione cliente non confermata: ${errDetail}`);
          err.isPublic=true;
          throw err;
        }
      }
      await this.#verify(studio,client);
    }

    this.#phase='apertura delle consultazioni del cliente';
    const alreadyInConsult = await p.locator('a[href*="Ric="], a:has-text("Dichiarazioni"), a:has-text("Versamenti"), a:has-text("Anagrafica")').first().isVisible().catch(() => false);
    if (!alreadyInConsult) {
      const vaiConsult = p.locator('a, button, [role="button"], [role="link"]').filter({ hasText: /Consultazioni/i }).first();
      if (await vaiConsult.count() > 0 && await vaiConsult.isVisible().catch(() => false)) {
        await vaiConsult.click({ timeout: 10000 }).catch(() => {});
      }
    }

    const pages = p.context().pages();
    if (pages.length > 1) {
      p = pages[pages.length - 1];
      this.#page = p;
    }
    await p.waitForLoadState('domcontentloaded').catch(() => {});

    const serviceHub = p.locator('a[href*="Ric="], a:has-text("Dichiarazioni"), a:has-text("Versamenti"), a:has-text("Anagrafica"), a:has-text("Registro")').first();
    await serviceHub.waitFor({ state: 'visible', timeout: 20000 });
    await this.#verify(studio, client);
  }

  async #f24(studio,client,year){
    if(!/^20\d{2}$/.test(String(year)))throw new Error('Anno non valido.');
    await this.#select(studio,client);
    let p=this.#page;
    this.#phase='apertura dei versamenti F24';
    const versArea = p.locator('a[href*="Ric=VERS"], a:has-text("Versamenti")').first();
    await versArea.waitFor({ state: 'visible', timeout: 15000 });
    await versArea.click();
    await p.waitForLoadState('domcontentloaded').catch(() => {});

    const pages = p.context().pages();
    if (pages.length > 1) {
      p = pages[pages.length - 1];
      this.#page = p;
    }
    await this.#verify(studio,client);

    this.#phase='scelta dell’anno dei versamenti F24';
    const yearSelect = p.locator('select[name*="anno" i], select[id*="anno" i]');
    if (await yearSelect.count() > 0 && await yearSelect.first().isVisible().catch(() => false)) {
      await yearSelect.first().selectOption({ label: String(year) }).catch(async () => {
        await yearSelect.first().selectOption(String(year));
      });
      const submitYear = p.locator('input[type="submit"], button').filter({ hasText: /Conferma|Cerca|Visualizza/i }).first();
      if (await submitYear.count() > 0) await submitYear.click();
    } else {
      const yearLink = p.locator('a').filter({ hasText: new RegExp(`^\\s*${year}\\b`) }).or(p.locator('a').filter({ hasText: new RegExp(String(year)) })).first();
      await yearLink.waitFor({ state: 'visible', timeout: 15000 });
      await yearLink.click();
    }
    await p.waitForLoadState('domcontentloaded').catch(() => {});
    await this.#verify(studio,client);

    return p.locator('table tbody tr, table tr').evaluateAll(rows => {
      const records = [];
      for (const row of rows) {
        const tds = [...row.querySelectorAll('td')];
        if (tds.length < 2) continue;

        const rowText = row.textContent.replace(/\s+/g, ' ').trim();
        const cellTexts = tds.map(td => td.textContent.replace(/\s+/g, ' ').trim());
        const links = [...row.querySelectorAll('a[href]')];
        let quietanzaUrl = null;
        let protocolFromLink = null;

        for (const a of links) {
          try {
            const u = new URL(a.href, window.location.href);
            const ric = (u.searchParams.get('Ric') || '').toLowerCase();
            const stampa = u.searchParams.get('stampa') || '';
            if (ric.includes('f24') || stampa === 'Q' || a.textContent.includes('Q')) {
              quietanzaUrl = u.href;
            }
            const textMatch = a.textContent.trim().match(/\b\d{15,25}(?:[-\s]\d+)?\b/);
            if (textMatch) {
              protocolFromLink = textMatch[0];
              if (!quietanzaUrl) quietanzaUrl = u.href;
            }
          } catch {}
        }

        // 1. Data: formato GG/MM/AAAA o G/M/AAAA o GG-MM-AAAA
        let date = '';
        const dateMatch = rowText.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/);
        if (dateMatch) {
          const d = dateMatch[1].padStart(2, '0');
          const m = dateMatch[2].padStart(2, '0');
          const y = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
          date = `${d}/${m}/${y}`;
        }

        // 2. Protocollo
        let protocol = protocolFromLink || '';
        if (!protocol) {
          const m = rowText.match(/\b\d{15,30}(?:[-\s]\d+)?\b/);
          if (m) protocol = m[0].replace(/\s+/g, '');
        }

        // 3. Saldo / Importo
        let balance = '';
        const balMatch = rowText.match(/-?[\d\.]*,\d{2}/);
        if (balMatch) balance = balMatch[0];

        // 4. Modello
        let model = cellTexts.find(t => /^F24/i.test(t)) || 'F24';

        if (date || balance || protocol || quietanzaUrl) {
          if (!quietanzaUrl && links.length > 0) quietanzaUrl = links[0].href;
          records.push({
            date: date || '—',
            models: model,
            balance: balance || '0,00',
            protocol: protocol || (links.length > 0 ? links[0].textContent.trim() : '—'),
            quietanzaUrl: quietanzaUrl
          });
        }
      }
      return records;
    });
  }

  listF24({studio,client,year}){
    return this.#exclusive(async()=>({studio:validateTaxCode(studio),client:validateTaxCode(client),year,records:await this.#f24(studio,client,year)}));
  }

  downloadF24({studio,client,year,protocol}){
    return this.#exclusive(async()=>{
      if(!protocol||protocol==='-')throw new Error('Protocollo quietanza mancante.');
      const rows=await this.#f24(studio,client,year);
      const matches=rows.filter(r=>r.protocol===protocol);
      if(!matches.length||!matches[0].quietanzaUrl)throw new Error('Quietanza non disponibile per il protocollo indicato.');
      const targetUrl=matches[0].quietanzaUrl;
      await this.#verify(studio,client);

      let target;
      for(const link of await this.#page.locator('a[href]').all()){
        const href=await link.getAttribute('href');
        if(href&&new URL(href,this.#page.url()).href===targetUrl){target=link;break;}
      }
      if(!target){
        target=this.#page.locator('a').filter({hasText:protocol}).first();
      }
      if(await target.count()===0)throw new Error('Collegamento quietanza non trovato nella tabella.');

      this.#phase='download della quietanza F24';

      // Clicchiamo sul target (apre il dettaglio del versamento)
      let detailPage = await clickAndFollow(this.#page, target);
      this.#page = detailPage;

      // 1. Verifichiamo se c'è un link "Pdf" o "Formato stampabile" e scarichiamo il buffer via API request
      const pdfLinks = detailPage.locator('a[href]').filter({hasText:/^Pdf$|^PDF$|Formato\s+stampabile|Quietanza|Stampa/i});
      for(const link of await pdfLinks.all()){
        const href=await link.getAttribute('href');
        if(href&&!href.startsWith('javascript:')&&!href.startsWith('#')){
          const fullUrl=new URL(href,detailPage.url()).href;
          try{
            const res=await detailPage.request.get(fullUrl);
            if(res.ok()){
              const buf=await res.body();
              if(buf.subarray(0,4).toString()==='%PDF'){
                await this.#verify(studio,client);
                return {buffer:buf,metadata:{studio,client,year,protocol,kind:'f24',source:'agenzia-entrate',acquiredAt:new Date().toISOString()}};
              }
            }
          }catch{}
        }
      }

      // 2. Click con attesa download o popup
      const clickTarget = detailPage.locator('a, button, input[type="submit"]').filter({hasText:/Quietanza|Stampa|Scarica|^Pdf$|^PDF$|Formato\s+stampabile/i}).first();
      if(await clickTarget.count()>0){
        const dlPromise = detailPage.waitForEvent('download',{timeout:30000}).catch(()=>null);
        const popupPromise = detailPage.context().waitForEvent('page',{timeout:15000}).catch(()=>null);

        await clickTarget.click();

        const dl = await dlPromise;
        if(dl && !await dl.failure()){
          await this.#verify(studio,client);
          dl.download = dl;
          return {download:dl,metadata:{studio,client,year,protocol,kind:'f24',source:'agenzia-entrate',acquiredAt:new Date().toISOString()}};
        }

        const popup = await popupPromise;
        if(popup){
          const popupUrl = popup.url();
          try{
            const res = await popup.request.get(popupUrl);
            if(res.ok()){
              const buf = await res.body();
              if(buf.subarray(0,4).toString()==='%PDF'){
                await popup.close().catch(()=>{});
                await this.#verify(studio,client);
                return {buffer:buf,metadata:{studio,client,year,protocol,kind:'f24',source:'agenzia-entrate',acquiredAt:new Date().toISOString()}};
              }
            }
          }catch{}
          await popup.close().catch(()=>{});
        }
      }

      throw new Error('Download quietanza non completato dal portale.');
    });
  }

  async openDocuments(studio,client){
    await this.#select(studio,client);
    let p=this.#page;
    this.#phase='apertura delle dichiarazioni fiscali';
    const declArea = p.locator('a[href*="Ric=REDD"], a:has-text("Dichiarazioni fiscali")').first();
    await declArea.waitFor({ state: 'visible', timeout: 15000 });
    await declArea.click();
    await p.waitForLoadState('domcontentloaded').catch(() => {});

    const pages = p.context().pages();
    if (pages.length > 1) {
      p = pages[pages.length - 1];
      this.#page = p;
    }
    await this.#verify(studio,client);
    return p;
  }

  listDocumentTypes({studio,client}){
    return this.#exclusive(async()=>{
      const p=await this.openDocuments(studio,client);
      const types=await readDocumentOptions(p,'types');
      return {types};
    });
  }

  listDocumentYears({studio,client,model}){
    return this.#exclusive(async()=>{
      let p=await this.openDocuments(studio,client);
      this.#phase='scelta della tipologia di documento: ' + model;
      p = await chooseDocumentOption(p,'types',model);
      this.#page = p;
      await this.#verify(studio,client);
      const years=await readDocumentOptions(p,'years');
      return {years, model};
    });
  }

  downloadCurrentDeclaration({studio,client,model,year}){
    return this.#exclusive(async()=>{
      let p=await this.openDocuments(studio,client);
      this.#page = p;

      if(!model){
        const types=await readDocumentOptions(p,'types');
        if(types.length)model=types[0].value;
      }
      if(model){
        this.#phase='scelta della tipologia di documento: ' + model;
        p = await chooseDocumentOption(p,'types',model);
        this.#page = p;
        await this.#verify(studio,client);
      }

      if(!year){
        const years=await readDocumentOptions(p,'years');
        if(years.length)year=years[0].value;
      }
      if(year){
        this.#phase='scelta dell’annualità del documento: ' + year;
        p = await chooseDocumentOption(p,'years',year);
        this.#page = p;
        await this.#verify(studio,client);
      }

      const titleNode = p.locator('h1, h2, h3, h4').filter({ hasText: /modello|dichiarazione|certificazione/i }).first();
      const title = (await titleNode.innerText().catch(() => model || 'Dichiarazione')).trim();
      await this.#verify(studio,client);

      this.#phase='generazione del PDF della dichiarazione';
      const result=await reproduceDocumentPdf(p);
      await this.#verify(studio,client);
      return {...result,metadata:{studio,client,title,model,year,kind:'dichiarazione',source:'agenzia-entrate',acquiredAt:new Date().toISOString()}};
    });
  }
}

export async function reproduceDocumentPdf(page){
  let p = page;

  // Se compare una tabella di documenti (es. elenco Certificazioni Uniche dell'anno):
  // Clicchiamo sul primo link/protocollo per accedere al dettaglio
  const tableRows = p.locator('table tbody tr, table tr').filter({ has: p.locator('a[href]') });
  if (await tableRows.count() > 0) {
    const candidateLinks = tableRows.locator('a[href]').filter({ hasNotText: /Torna|Esci|Home|successiv|precedent/i });
    if (await candidateLinks.count() > 0) {
      const detailLink = candidateLinks.first();
      if (await detailLink.isVisible().catch(() => false)) {
        p = await clickAndFollow(p, detailLink);
      }
    }
  }

  // 1. Verifichiamo se c'è un link diretto "Pdf", "Formato stampabile", "Stampa"
  const pdfLinks = p.locator('a[href]').filter({ hasText: /^Pdf$|^PDF$|Formato\s+stampabile|Riproduci.*pdf|Scarica.*pdf|Stampa\s*certificazione|Stampa\s*modello/i });
  if (await pdfLinks.count() > 0) {
    for (const link of await pdfLinks.all()) {
      const href = await link.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        const fullUrl = new URL(href, p.url()).href;
        try {
          const res = await p.request.get(fullUrl);
          if (res.ok()) {
            const buf = await res.body();
            if (buf.subarray(0, 4).toString() === '%PDF') {
              return { buffer: buf };
            }
          }
        } catch {}
      }
    }
  }

  // 2. Se non acquisito via GET diretta, cerchiamo qualsiasi pulsante di generazione/stampa PDF
  const command = p.locator('a, button, [role="button"], [role="tab"], input[type="submit"]')
    .filter({ hasText: /Riproduci|Genera\s*PDF|^Pdf$|^PDF$|Formato\s+stampabile|Stampa|Scarica/i })
    .first();

  if (await command.count() > 0 && await command.isVisible().catch(() => false)) {
    const downloadPromise = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    const popupPromise = p.context().waitForEvent('page', { timeout: 15000 }).catch(() => null);

    await command.click();

    const quickDl = await Promise.race([
      downloadPromise,
      new Promise(r => setTimeout(() => r(null), 3000))
    ]);
    if (quickDl && !await quickDl.failure()) {
      quickDl.download = quickDl;
      return quickDl;
    }

    // Se si apre il form con la scelta "Dichiarazione completa" / "Genera PDF"
    const generate = p.locator('button, input[type="submit"], a').filter({ hasText: /^Genera\s+PDF$/i }).filter({ visible: true }).first();
    if (await generate.count() > 0 && await generate.isVisible().catch(() => false)) {
      const complete = p.locator('input[type="radio"]').filter({ hasText: /completa/i }).or(p.getByRole('radio', { name: /completa/i })).or(p.locator('label:has-text("completa") input')).filter({ visible: true }).first();
      if (await complete.count() > 0) await complete.check().catch(() => {});

      const [dl] = await Promise.all([
        p.waitForEvent('download', { timeout: 45000 }),
        generate.click()
      ]);
      if (dl && !await dl.failure()) {
        dl.download = dl;
        return dl;
      }
    }

    const popup = await popupPromise;
    if (popup) {
      const popupUrl = popup.url();
      try {
        const res = await popup.request.get(popupUrl);
        if (res.ok()) {
          const buf = await res.body();
          if (buf.subarray(0, 4).toString() === '%PDF') {
            await popup.close().catch(() => {});
            return { buffer: buf };
          }
        }
      } catch {}
      await popup.close().catch(() => {});
    }

    const finalDl = await downloadPromise;
    if (finalDl && !await finalDl.failure()) {
      finalDl.download = finalDl;
      return finalDl;
    }
  }

  throw new Error('Comando di generazione o download PDF non trovato nella pagina del documento.');
}

export async function readDocumentOptions(page, kind) {
  return page.locator('a').evaluateAll((links, kind) => {
    const pattern = kind === 'types'
      ? /(?:Certificazione unica|Modello|730|770|IVA|IRAP|Redditi percepiti|Dichiarazion)/i
      : /\b(?:19|20)\d{2}\b/;
    const found = new Map();
    for (const a of links) {
      const label = a.textContent.replace(/\s+/g, ' ').trim();
      if (!pattern.test(label)) continue;
      if (kind === 'years' && /Documenti non presenti/i.test(label)) continue;
      if (!a.getClientRects().length || a.getAttribute('aria-hidden') === 'true' || a.offsetParent === null) continue;
      if (a.hostname && a.hostname !== window.location.hostname && !a.href.startsWith('#') && !a.href.startsWith('/')) continue;
      if (kind === 'years' && a.href && a.href.includes('outside.test')) continue;

      let key = label;
      let cleanLabel = label;
      if (kind === 'years') {
        cleanLabel = label.replace(/Documenti presenti.*/i, '').trim();
        key = cleanLabel;
      }

      if (!found.has(key)) {
        found.set(key, { value: key, label: cleanLabel, raw: label });
      }
    }
    return [...found.values()];
  }, kind);
}

export async function chooseDocumentOption(page, kind, value) {
  let p = page;
  const options = await readDocumentOptions(p, kind);
  if (!options.length) {
    throw new Error('Nessun documento o annualità disponibile per il cliente selezionato.');
  }

  let selectedOption = options.find(o => o.value === value || o.label === value);
  if (!selectedOption && typeof value === 'string') {
    const yearDigits = value.match(/\b(?:19|20)\d{2}\b/)?.[0];
    if (kind === 'years' && yearDigits) {
      selectedOption = options.find(o => new RegExp('^\\s*' + yearDigits + '\\b').test(o.value) || new RegExp('^\\s*' + yearDigits + '\\b').test(o.label));
    } else {
      selectedOption = options.find(o => o.value.includes(value) || o.label.includes(value));
    }
  }

  if (!selectedOption) {
    throw new Error(`Annualità o opzione ${value} non disponibile per il cliente selezionato.`);
  }

  let targetLocator;
  if (kind === 'years') {
    const yearDigits = (selectedOption.value || value).match(/\b(?:19|20)\d{2}\b/)?.[0];
    if (yearDigits) {
      targetLocator = p.locator('a').filter({ hasText: new RegExp('^\\s*' + yearDigits + '\\b') });
      if (await targetLocator.count() === 0) {
        targetLocator = p.locator('a').filter({ hasText: selectedOption.value });
      }
    } else {
      targetLocator = p.locator('a').filter({ hasText: selectedOption.value });
    }
  } else {
    targetLocator = p.locator('a').filter({ hasText: selectedOption.value });
  }

  const count = await targetLocator.count();
  if (count > 1) {
    const hrefs = await targetLocator.evaluateAll(els => els.map(e => e.getAttribute('href')));
    const uniqueHrefs = new Set(hrefs);
    if (uniqueHrefs.size > 1) {
      throw new Error(`Selezione ambigua per ${value}: trovati ${count} elementi corrispondenti.`);
    }
  }

  const targetLink = targetLocator.first();
  if (count > 0 && await targetLink.isVisible().catch(() => false)) {
    p = await clickAndFollow(p, targetLink);
  } else {
    const fallback = p.locator('a').filter({ hasText: value }).first();
    if (await fallback.count() > 0) {
      p = await clickAndFollow(p, fallback);
    } else {
      throw new Error(`Opzione ${value} non trovata sul portale.`);
    }
  }

  return p;
}

export async function selectDeclarationModel(page, model) {
  if (model === 'cu') throw new Error('Modello CU non valido.');
  const map = {
    'redditi': 'Modello unico/redditi persone fisiche',
    '730': 'Modello 730'
  };
  const target = map[model] || model;
  return chooseDocumentOption(page, 'types', target);
}
