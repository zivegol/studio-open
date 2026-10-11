(function () {
  "use strict";

  const state = {
    registry: new Map(),
    records: [],
    filtered: [],
    generatedAt: null,
    generationErrors: [],
    generationWarnings: [],
    sourceFileCount: 0,
    savedFilters: null,
    projectReady: false,
    saveTimer: null
  };

  const APP_VERSION = "20260816";
  const PROJECT_FOLDER = "Studio/Bilanci";
  const PROJECT_PATH = PROJECT_FOLDER + "/analytics-project.json";
  const MANIFEST_PATH = PROJECT_FOLDER + "/analytics-manifest.json";

  const $ = (id) => document.getElementById(id);
  const els = {
    loadBtn: $("loadBtn"),
    saveProjectBtn: $("saveProjectBtn"),
    exportBtn: $("exportBtn"),
    resetBtn: $("resetBtn"),
    log: $("log"),
    ncBase: $("ncBase"),
    ncUser: $("ncUser"),
    userHint: $("userHint"),
    baseFolder: $("baseFolder"),
    registryPath: $("registryPath"),
    yearsInput: $("yearsInput"),
    clientFilter: $("clientFilter"),
    atecoFilter: $("atecoFilter"),
    geoFilter: $("geoFilter"),
    comuneFilter: $("comuneFilter"),
    yearFilter: $("yearFilter"),
    employeeClassFilter: $("employeeClassFilter"),
    revenueClassFilter: $("revenueClassFilter"),
    rowsBody: $("rowsBody"),
    mainGrid: $("mainGrid"),
    analysisTitle: $("analysisTitle"),
    analysisNote: $("analysisNote"),
    verticalView: $("verticalView"),
    benchmarkView: $("benchmarkView"),
    trendChart: $("trendChart"),
    atecoChart: $("atecoChart"),
    projectStatus: $("projectStatus")
  };

  function setProjectStatus(message, error = false) {
    els.projectStatus.textContent = message;
    els.projectStatus.style.color = error ? "var(--red)" : "var(--muted)";
  }

  async function sha256(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function log(message) {
    const time = new Date().toLocaleTimeString("it-IT");
    els.log.textContent += `[${time}] ${message}\n`;
    els.log.scrollTop = els.log.scrollHeight;
  }

  function appOrigin() {
    return window.location.origin && window.location.origin !== "null" ? window.location.origin : els.ncBase.value.trim();
  }

  function initDefaults() {
    if (window.location.origin && /^https?:\/\//.test(window.location.origin)) {
      els.ncBase.value = window.location.origin;
    }
    log(`App pronta. Origine: ${appOrigin()}`);
    log(`Libreria Excel: ${window.XLSX ? "caricata" : "non ancora disponibile"}`);
    detectCurrentUser();
  }

  async function ensureXlsx() {
    if (window.XLSX) return;
    log("Carico la libreria Excel...");
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `xlsx.full.min.js?v=20260618-diagnostics-${Date.now()}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Impossibile caricare xlsx.full.min.js"));
      document.head.appendChild(script);
    });
    if (!window.XLSX) throw new Error("La libreria Excel non e disponibile nel browser.");
    log("Libreria Excel caricata.");
  }

  function localApiUrl(params) {
    const url = new URL(`${appOrigin()}/studio-apps/bilanci-analytics/files.php`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }

  async function localApiJson(params) {
    const url = localApiUrl(params);
    log(`API ${url}`);
    const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const data = await res.json();
        if (data?.error) message += `: ${data.error}`;
      } catch (err) {
        // Keep the HTTP error when the response is not JSON.
      }
      throw new Error(message);
    }
    return res.json();
  }

  async function localApiBuffer(path) {
    const url = localApiUrl({ op: "file", path });
    log(`API GET ${path}`);
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
    return res.arrayBuffer();
  }

  async function detectCurrentUser() {
    try {
      const data = await StudioStorage.getCurrentUser();
      const userId = data?.id;
      if (userId) {
        els.userHint.textContent = `Utente Nextcloud rilevato: ${userId}`;
        els.ncUser.value = userId;
      }
    } catch (err) {
      els.userHint.textContent = "Utente Nextcloud non rilevato automaticamente.";
    }
  }

  async function loadPrebuiltData() {
    const url = `${appOrigin()}/studio-apps/bilanci-analytics/analytics-data.json?v=${Date.now()}`;
    let data = null;
    try {
      data = await loadScriptIndex();
    } catch (scriptError) {
      log(`Indice script non disponibile, provo JSON: ${scriptError.message}`);
      log(`Leggo indice dati: ${url}`);
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" }
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      data = await res.json();
    }
    if (!Array.isArray(data.records)) throw new Error("Formato indice dati non valido");
    state.records = data.records;
    state.generatedAt = data.generatedAt || null;
    state.generationErrors = Array.isArray(data.errors) ? data.errors : [];
    state.generationWarnings = Array.isArray(data.warnings) ? data.warnings : [];
    state.sourceFileCount = Number(data.sourceFileCount) || state.records.length + state.generationErrors.length;
    populateFilters();
    restoreSavedFilters();
    applyFilters();
    els.exportBtn.disabled = state.records.length === 0;
    log(`Indice generato: ${data.generatedAt || "n/d"}`);
    if (Array.isArray(data.errors) && data.errors.length) {
      log(`Avvisi generazione dati: ${data.errors.length}`);
    }
    log(`Caricamento completato da indice: ${state.records.length} osservazioni.`);
    scheduleProjectSave();
    return true;
  }

  function projectDocument() {
    return {
      schemaVersion: 1,
      app: "bilanci-analytics",
      appVersion: APP_VERSION,
      updatedAt: new Date().toISOString(),
      configuration: {
        baseFolder: els.baseFolder.value.trim(),
        registryPath: els.registryPath.value.trim(),
        years: els.yearsInput.value.trim()
      },
      filters: {
        client: els.clientFilter.value,
        ateco: els.atecoFilter.value,
        province: els.geoFilter.value,
        comune: els.comuneFilter.value,
        year: els.yearFilter.value,
        employeeClass: els.employeeClassFilter.value,
        revenueClass: els.revenueClassFilter.value
      },
      dataset: {
        generatedAt: state.generatedAt,
        recordCount: state.records.length,
        companyCount: new Set(state.records.map((r) => r.clientName)).size,
        sourceFiles: Array.from(new Set(state.records.map((r) => `${r.year}/${r.fileName}`))).sort(),
        generationErrorCount: state.generationErrors.length
        ,generationWarningCount: state.generationWarnings.length
      }
    };
  }

  async function saveProject(showConfirmation = false) {
    if (!state.projectReady || !window.StudioStorage) return;
    try {
      setProjectStatus("Salvataggio progetto...");
      const project = projectDocument();
      const projectJson = JSON.stringify(project);
      const datasetHash = await sha256(JSON.stringify(state.records));
      await StudioStorage.ensureFolder(PROJECT_FOLDER);
      await StudioStorage.put(PROJECT_PATH, projectJson, { contentType: "application/json;charset=utf-8" });
      await StudioStorage.put(MANIFEST_PATH, JSON.stringify({
        schemaVersion: 1,
        app: "bilanci-analytics",
        appVersion: APP_VERSION,
        updatedAt: project.updatedAt,
        projectPath: PROJECT_PATH,
        projectSha256: await sha256(projectJson),
        datasetSha256: datasetHash,
        ...project.dataset
      }, null, 2), { contentType: "application/json;charset=utf-8" });
      setProjectStatus("Progetto salvato in Nextcloud");
      if (showConfirmation) alert("Progetto Bilanci salvato in Nextcloud.");
    } catch (error) {
      setProjectStatus("Salvataggio non riuscito: " + error.message, true);
    }
  }

  function scheduleProjectSave() {
    if (!state.projectReady) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveProject(false), 700);
  }

  async function loadProject() {
    if (!window.StudioStorage) return;
    try {
      setProjectStatus("Lettura progetto Nextcloud...");
      const response = await StudioStorage.request(PROJECT_PATH, { method: "GET", headers: { Accept: "application/json" } });
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const project = await response.json();
      if (!project || project.schemaVersion !== 1) throw new Error("Formato progetto non compatibile");
      const config = project.configuration || {};
      if (config.baseFolder) els.baseFolder.value = config.baseFolder;
      if (config.registryPath) els.registryPath.value = config.registryPath;
      if (config.years) els.yearsInput.value = config.years;
      state.savedFilters = project.filters || null;
      setProjectStatus("Progetto Nextcloud caricato");
    } catch (error) {
      setProjectStatus("Caricamento non riuscito: " + error.message, true);
    }
  }

  function restoreSavedFilters() {
    if (!state.savedFilters) return;
    const saved = state.savedFilters;
    if (Array.from(els.clientFilter.options).some((o) => o.value === saved.client)) els.clientFilter.value = saved.client || "";
    if (Array.from(els.atecoFilter.options).some((o) => o.value === saved.ateco)) els.atecoFilter.value = saved.ateco || "";
    if (Array.from(els.geoFilter.options).some((o) => o.value === saved.province)) els.geoFilter.value = saved.province || "";
    if (Array.from(els.comuneFilter.options).some((o) => o.value === saved.comune)) els.comuneFilter.value = saved.comune || "";
    if (Array.from(els.yearFilter.options).some((o) => o.value === saved.year)) els.yearFilter.value = saved.year || "";
    if (Array.from(els.employeeClassFilter.options).some((o) => o.value === saved.employeeClass)) els.employeeClassFilter.value = saved.employeeClass || "";
    if (Array.from(els.revenueClassFilter.options).some((o) => o.value === saved.revenueClass)) els.revenueClassFilter.value = saved.revenueClass || "";
    state.savedFilters = null;
  }

  async function loadScriptIndex() {
    delete window.BILANCI_ANALYTICS_DATA;
    const src = `${appOrigin()}/studio-apps/bilanci-analytics/analytics-data.js?v=${Date.now()}`;
    log(`Leggo indice script: ${src}`);
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Impossibile caricare analytics-data.js"));
      document.head.appendChild(script);
    });
    if (!window.BILANCI_ANALYTICS_DATA) throw new Error("Indice script non valido");
    return window.BILANCI_ANALYTICS_DATA;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanId(value) {
    return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  function asNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value == null || value === "") return null;
    const normalized = String(value)
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    if (!normalized || normalized === "-" || normalized === ".") return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  function firstNumber(row, fromIndex, toIndex) {
    for (let i = fromIndex; i <= toIndex && i < row.length; i += 1) {
      const n = asNumber(row[i]);
      if (n !== null) return n;
    }
    return null;
  }

  function fmtCurrency(value) {
    if (value == null || !Number.isFinite(value)) return "-";
    const rounded = Math.round(value);
    return `${rounded.toLocaleString("it-IT", { useGrouping: true, maximumFractionDigits: 0 })} €`;
  }

  function fmtNumber(value, decimals = 0) {
    if (value == null || !Number.isFinite(value)) return "-";
    return value.toLocaleString("it-IT", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  }

  function fmtPercent(value) {
    if (value == null || !Number.isFinite(value)) return "-";
    return (value * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + "%";
  }

  function fmtSignedPercent(value) {
    if (value == null || !Number.isFinite(value)) return "-";
    const sign = value > 0 ? "+" : "";
    return sign + fmtPercent(value);
  }

  function fmtCompactCurrency(value) {
    if (value == null || !Number.isFinite(value)) return "-";
    const abs = Math.abs(value);
    if (abs >= 1000000) return `${fmtNumber(value / 1000000, 2)} mln €`;
    if (abs >= 1000) return `${fmtNumber(value / 1000, 0)} mila €`;
    return fmtCurrency(value);
  }

  function average(values) {
    const nums = values.filter((v) => Number.isFinite(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  function sum(values) {
    return values.filter(Number.isFinite).reduce((a, b) => a + b, 0);
  }

  function ratio(num, den) {
    return Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? num / den : null;
  }

  function yearSort(a, b) {
    return String(a.year).localeCompare(String(b.year));
  }

  function byYear(rows) {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.year)) map.set(row.year, []);
      map.get(row.year).push(row);
    }
    return Array.from(map, ([year, items]) => ({ year, items })).sort((a, b) => String(a.year).localeCompare(String(b.year)));
  }

  function davRoot() {
    const base = els.ncBase.value.trim().replace(/\/+$/, "") || appOrigin();
    const user = encodeURIComponent(els.ncUser.value.trim());
    return `${base}/remote.php/dav/files/${user}/`;
  }

  function encodeDavPath(path) {
    return String(path || "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  async function davRequest(path, options = {}) {
    const url = davRoot() + encodeDavPath(path);
    log(`${options.method || "GET"} ${url}`);
    const res = await fetch(url, {
      credentials: "include",
      ...options,
      headers: { ...(options.headers || {}) }
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}: ${path}`;
      if (res.status === 401 || res.status === 403) {
        detail += `. Accesso negato. Controlla che l'utente WebDAV "${els.ncUser.value.trim()}" sia quello con cui sei loggato in Nextcloud o abbia accesso alla cartella.`;
      }
      throw new Error(detail);
    }
    return res;
  }

  async function getArrayBuffer(path) {
    const res = await davRequest(path, { method: "GET" });
    return res.arrayBuffer();
  }

  function xmlElementsByLocalName(root, name) {
    return Array.from(root.getElementsByTagName("*")).filter((el) => el.localName === name);
  }

  async function listFolder(path) {
    const res = await davRequest(path, {
      method: "PROPFIND",
      headers: { Depth: "1", "Content-Type": "application/xml" },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>`
    });
    const xml = new DOMParser().parseFromString(await res.text(), "application/xml");
    const responses = xmlElementsByLocalName(xml, "response");
    const currentName = path.split("/").filter(Boolean).pop();
    const items = [];
    for (const response of responses) {
      const hrefEl = xmlElementsByLocalName(response, "href")[0];
      if (!hrefEl) continue;
      const href = decodeURIComponent(hrefEl.textContent || "");
      const segments = href.replace(/\/+$/, "").split("/");
      const name = segments[segments.length - 1] || "";
      if (!name || name === currentName) continue;
      const isFolder = xmlElementsByLocalName(response, "collection").length > 0;
      items.push({ name, isFolder, path: `${path.replace(/\/+$/, "")}/${name}` });
    }
    return items;
  }

  async function loadRegistry() {
    state.registry.clear();
    const path = els.registryPath.value.trim();
    log(`Leggo anagrafica: ${path}`);
    const buffer = await getFileBuffer({ path, apiPath: path });
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames.find((name) => normalizeText(name) === "elenco clienti 2026") || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const header = rows[0] || [];
    const employeeInC = /dipend|addett|n\./.test(normalizeText(header[2]));

    for (const row of rows.slice(1)) {
      const piva = cleanId(row[0]);
      const cf = cleanId(row[1]);
      const employees = employeeInC ? asNumber(row[2]) : null;
      const name = String(employeeInC ? row[3] : row[2] || "").trim();
      const legalForm = String(employeeInC ? row[4] : row[3] || "").trim();
      const ateco = cleanId(employeeInC ? row[5] : row[4]);
      if (!piva && !cf && !name) continue;
      const client = { name, legalForm, ateco, employees };
      if (piva) state.registry.set(piva, client);
      if (cf) state.registry.set(cf, client);
    }
    log(`Anagrafica caricata: ${state.registry.size} chiavi fiscali.`);
  }

  function workbookRows(wb, matcher) {
    const sheetName = wb.SheetNames.find((name) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
      return matcher(normalizeText(name), rows);
    });
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName || wb.SheetNames[0]], { header: 1, defval: "" });
  }

  function workbookPlainText(wb) {
    return wb.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
      return `${name}\n` + rows.map((row) => row.join(" ")).join("\n");
    }).join("\n");
  }

  function extractIds(text) {
    const ids = new Set();
    for (const match of text.toUpperCase().matchAll(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g)) ids.add(cleanId(match[0]));
    for (const match of text.matchAll(/\b\d{11}\b/g)) ids.add(match[0]);
    return Array.from(ids);
  }

  function extractGeo(text) {
    const match = text.match(/\b(\d{5})\s+([A-Za-zÀ-ÖØ-öø-ÿ' .-]{2,80}?)\s*\(([A-Z]{2})\)/);
    if (!match) return { cap: "", comune: "", provincia: "" };
    return { cap: match[1], comune: match[2].trim(), provincia: match[3] };
  }

  function findCeMetrics(rows) {
    let revenues = null, costs = null, purchases = null, services = null;
    let leases = null, personnel = null, amortization = null, financialCharges = null, taxes = null;
    for (const row of rows) {
      const left = normalizeText(row.slice(0, 14).join(" "));
      const right = normalizeText(row.slice(14).join(" "));
      if (costs === null && left.includes("costi")) costs = firstNumber(row, 7, 12);
      if (revenues === null && right.includes("ricavi")) revenues = firstNumber(row, 20, 27);
      if (purchases === null && left.includes("costi per acquisto")) purchases = firstNumber(row, 7, 12);
      if (services === null && left.includes("costi per servizi")) services = firstNumber(row, 7, 12);
      if (leases === null && left.includes("godimento beni di terzi")) leases = firstNumber(row, 7, 12);
      if (personnel === null && left.includes("costi per il personale")) personnel = firstNumber(row, 7, 12);
      if (amortization === null && (left.includes("ammortament") || left.includes("amm.ti"))) amortization = firstNumber(row, 7, 12);
      if (financialCharges === null && left.includes("oneri finanziari")) financialCharges = firstNumber(row, 7, 12);
      if (taxes === null && left.includes("imposte sul reddito")) taxes = firstNumber(row, 7, 12);
    }
    return { revenues, costs, purchases, services, leases, personnel, amortization, financialCharges, taxes };
  }

  function findSpMetrics(rows) {
    let assets = null, liabilitiesAndEquity = null, debts = null, equity = null;
    let receivables = null, cash = null, inventory = null;
    for (const row of rows) {
      const left = normalizeText(row.slice(0, 12).join(" "));
      const right = normalizeText(row.slice(12).join(" "));
      if (left.includes("totale attivo")) assets = firstNumber(row, 7, 11);
      else if (assets === null && left === "attivo") assets = firstNumber(row, 7, 11);
      if (right.includes("totale passivo")) liabilitiesAndEquity = firstNumber(row, 14, 18);
      else if (liabilitiesAndEquity === null && right.includes("passivo e patrimonio netto")) liabilitiesAndEquity = firstNumber(row, 14, 18);
      if (debts === null && right.includes("debiti")) debts = firstNumber(row, 14, 18);
      if (equity === null && right.includes("patrimonio netto") && !right.includes("passivo e patrimonio netto")) equity = firstNumber(row, 14, 18);
      if (receivables === null && left.includes("crediti")) receivables = firstNumber(row, 7, 11);
      if (cash === null && left.includes("disponibilita") && left.includes("liquide")) cash = firstNumber(row, 7, 11);
      if (inventory === null && left.includes("rimanenze")) inventory = firstNumber(row, 7, 11);
    }
    return { assets, liabilitiesAndEquity, debts, equity, receivables, cash, inventory };
  }

  function balanceSheetTotals(sp) {
    const assets = sp.assets;
    const debts = sp.debts;
    const equityRaw = sp.equity;
    const liabilitiesRaw = sp.liabilitiesAndEquity;
    let equity = equityRaw;
    let liabilitiesAndEquity = liabilitiesRaw;
    let spBalancingAdjustment = null;
    if (Number.isFinite(assets) && Number.isFinite(debts)) {
      const computedEquity = assets - debts;
      if (!Number.isFinite(liabilitiesRaw) || Math.abs(liabilitiesRaw - assets) > 1) {
        liabilitiesAndEquity = assets;
        equity = computedEquity;
        if (Number.isFinite(equityRaw) && Math.abs(computedEquity - equityRaw) > 1) {
          spBalancingAdjustment = computedEquity - equityRaw;
        }
      }
    }
    return { equity, liabilitiesAndEquity, equityRaw, liabilitiesAndEquityRaw: liabilitiesRaw, spBalancingAdjustment };
  }

  function inferClient(fileName, identifiers) {
    for (const id of identifiers) if (state.registry.has(id)) return state.registry.get(id);
    return { name: fileName.replace(/\.[^.]+$/, ""), legalForm: "", ateco: "", employees: null };
  }

  function parseWorkbook(buffer, fileName, year) {
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const text = workbookPlainText(wb);
    const identifiers = extractIds(text);
    const client = inferClient(fileName, identifiers);
    const geo = extractGeo(text);
    const ceRows = workbookRows(wb, (sheetName, rows) => sheetName.includes("conto") || rows.some((r) => normalizeText(r.join(" ")).includes("conto economico")));
    const spRows = workbookRows(wb, (sheetName, rows) => sheetName.includes("stato") || rows.some((r) => normalizeText(r.join(" ")).includes("stato patrimoniale")));
    const ce = findCeMetrics(ceRows);
    const sp = findSpMetrics(spRows);
    const balancedSp = balanceSheetTotals(sp);
    const result = Number.isFinite(ce.revenues) && Number.isFinite(ce.costs) ? ce.revenues - ce.costs : null;
    const margin = Number.isFinite(result) && ce.revenues ? result / ce.revenues : null;
    const operatingInputs = [ce.purchases, ce.services, ce.leases, ce.personnel].filter(Number.isFinite).reduce((a, b) => a + b, 0);
    const ebitda = Number.isFinite(ce.revenues) && operatingInputs ? ce.revenues - operatingInputs : null;
    const ebit = Number.isFinite(ebitda) && Number.isFinite(ce.amortization) ? ebitda - ce.amortization : null;
    const ebitdaMargin = Number.isFinite(ebitda) && ce.revenues ? ebitda / ce.revenues : null;
    const ros = Number.isFinite(ebit) && ce.revenues ? ebit / ce.revenues : null;
    const roi = Number.isFinite(ebit) && sp.assets ? ebit / sp.assets : null;
    const roe = Number.isFinite(result) && balancedSp.equity ? result / balancedSp.equity : null;
    const debtRatio = Number.isFinite(sp.debts) && sp.assets ? sp.debts / sp.assets : null;
    const currentAssets = [sp.receivables, sp.cash, sp.inventory].filter(Number.isFinite).reduce((a, b) => a + b, 0);
    const currentRatio = currentAssets && sp.debts ? currentAssets / sp.debts : null;
    const employeeCount = Number.isFinite(client.employees) && client.employees > 0 ? client.employees : null;
    const revenuePerEmployee = employeeCount && ce.revenues ? ce.revenues / employeeCount : null;
    const resultPerEmployee = employeeCount && Number.isFinite(result) ? result / employeeCount : null;
    const costsPerEmployee = employeeCount && ce.costs ? ce.costs / employeeCount : null;
    return {
      id: `${year}-${fileName}`,
      fileName, year,
      clientName: client.name || fileName.replace(/\.[^.]+$/, ""),
      legalForm: client.legalForm || "",
      ateco: client.ateco || "",
      employees: client.employees,
      cap: geo.cap, comune: geo.comune, provincia: geo.provincia,
      fiscalIds: identifiers.join(", "),
      revenues: ce.revenues, costs: ce.costs, purchases: ce.purchases, services: ce.services,
      leases: ce.leases, personnel: ce.personnel, amortization: ce.amortization,
      financialCharges: ce.financialCharges, taxes: ce.taxes, ebitda, ebitdaMargin, ebit, ros, roi, roe,
      result, margin,
      assets: sp.assets, liabilitiesAndEquity: balancedSp.liabilitiesAndEquity,
      liabilitiesAndEquityRaw: balancedSp.liabilitiesAndEquityRaw,
      debts: sp.debts, equity: balancedSp.equity, equityRaw: balancedSp.equityRaw,
      spBalancingAdjustment: balancedSp.spBalancingAdjustment,
      receivables: sp.receivables, cash: sp.cash, inventory: sp.inventory,
      debtRatio, currentRatio, revenuePerEmployee, resultPerEmployee, costsPerEmployee
    };
  }

  async function loadData() {
    els.loadBtn.disabled = true;
    els.exportBtn.disabled = true;
    els.log.textContent = "";
    state.records = [];
    try {
      try {
        if (await loadPrebuiltData()) return;
      } catch (err) {
        log(`Indice dati non disponibile, provo lettura diretta: ${err.message}`);
      }
      await ensureXlsx();
      await loadRegistry();
      const base = els.baseFolder.value.trim().replace(/\/+$/, "");
      const years = els.yearsInput.value.split(",").map((y) => y.trim()).filter(Boolean);
      let localListing = null;
      try {
        localListing = await localApiJson({ op: "list", base, years: years.join(",") });
        log(`Lettura locale attiva. Utente autorizzato: ${localListing.user || "n/d"}`);
      } catch (err) {
        log(`Lettura locale non disponibile, provo WebDAV: ${err.message}`);
      }
      for (const year of years) {
        const yearPath = `${base}/${year}`;
        try {
          log(`Scansiono ${yearPath}`);
          const files = localListing
            ? (localListing.years?.[year] || []).map((item) => ({ ...item, apiPath: item.path }))
            : (await listFolder(yearPath)).filter((item) => !item.isFolder && !item.name.startsWith("~$") && /\.(xlsx|xlsm|xls)$/i.test(item.name) && !/anonimizzat/i.test(item.path));
          log(`${year}: ${files.length} file Excel trovati.`);
          for (const file of files) {
            try {
              const buffer = await getFileBuffer(file);
              state.records.push(parseWorkbook(buffer, file.name, year));
              log(`OK ${year}/${file.name}`);
            } catch (err) {
              log(`Errore su ${file.name}: ${err.message}`);
            }
          }
        } catch (err) {
          log(`Salto ${year}: ${err.message}`);
        }
      }
      populateFilters();
      restoreSavedFilters();
      applyFilters();
      els.exportBtn.disabled = state.records.length === 0;
      log(`Caricamento completato: ${state.records.length} osservazioni.`);
    } catch (err) {
      log(`Errore: ${err.message}`);
    } finally {
      els.loadBtn.disabled = false;
    }
  }

  async function getFileBuffer(file) {
    if (file.apiPath) {
      try {
        return await localApiBuffer(file.apiPath);
      } catch (err) {
        log(`API locale non riuscita per ${file.name || file.path}: ${err.message}`);
      }
    }
    return getArrayBuffer(file.path);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function uniqueSorted(records, key) {
    return Array.from(new Set(records.map((r) => r[key]).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), "it"));
  }

  function fillSelect(select, values, allLabel) {
    const oldValue = select.value;
    select.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (values.includes(oldValue)) select.value = oldValue;
  }

  function populateFilters() {
    fillSelect(els.clientFilter, uniqueSorted(state.records, "clientName"), "Tutti");
    fillSelect(els.atecoFilter, uniqueSorted(state.records, "ateco"), "Tutti");
    fillSelect(els.geoFilter, uniqueSorted(state.records, "provincia"), "Tutte");
    fillSelect(els.comuneFilter, uniqueSorted(state.records, "comune"), "Tutti");
    fillSelect(els.yearFilter, uniqueSorted(state.records, "year"), "Tutti");
    fillSelect(els.employeeClassFilter, uniqueSorted(state.records, "employeeClass"), "Tutte le classi");
    fillSelect(els.revenueClassFilter, uniqueSorted(state.records, "revenueClass"), "Tutte le classi");
  }

  function applyFilters() {
    state.filtered = state.records.filter((r) =>
      (!els.clientFilter.value || r.clientName === els.clientFilter.value) &&
      (!els.atecoFilter.value || r.ateco === els.atecoFilter.value) &&
      (!els.geoFilter.value || r.provincia === els.geoFilter.value) &&
      (!els.comuneFilter.value || r.comune === els.comuneFilter.value) &&
      (!els.yearFilter.value || r.year === els.yearFilter.value) &&
      (!els.employeeClassFilter.value || r.employeeClass === els.employeeClassFilter.value) &&
      (!els.revenueClassFilter.value || r.revenueClass === els.revenueClassFilter.value)
    );
    render();
    scheduleProjectSave();
  }

  function metricClass(value) {
    if (!Number.isFinite(value)) return "";
    if (value < 0) return "bad";
    if (value > 0) return "ok";
    return "";
  }

  function render() {
    const rows = state.filtered;
    els.mainGrid.classList.toggle("client-mode", Boolean(els.clientFilter.value));
    $("sCompanies").textContent = new Set(rows.map((r) => r.clientName)).size;
    $("sRows").textContent = rows.length;
    $("sAvgRevenue").textContent = fmtCurrency(average(rows.map((r) => r.revenues)));
    $("sAvgMargin").textContent = fmtPercent(average(rows.map((r) => r.margin)));
    $("sDebtRatio").textContent = fmtPercent(average(rows.map((r) => r.debtRatio)));
    $("sRevEmp").textContent = fmtCurrency(average(rows.map((r) => r.revenuePerEmployee)));
    $("sResultEmp").textContent = fmtCurrency(average(rows.map((r) => r.resultPerEmployee)));
    $("sSourceFiles").textContent = state.sourceFileCount;
    $("sWarnings").textContent = state.generationWarnings.length;
    $("sErrors").textContent = state.generationErrors.length;
    $("sUpdated").textContent = state.generatedAt ? new Date(state.generatedAt).toLocaleString("it-IT") : "-";
    renderAnalysis(rows);
    renderTable(rows);
    renderTrend(rows);
    renderAteco(rows);
  }

  function metricLine(label, value, formatter = fmtCurrency, cls = "", rowCls = "", composition = null) {
    const pct = Number.isFinite(composition) ? `<small class="metric-pct">${fmtPercent(composition)}</small>` : "";
    return `<div class="metric-line ${rowCls}"><span>${escapeHtml(label)}${pct}</span><strong class="${cls}">${formatter(value)}</strong></div>`;
  }

  function isSrl(row) {
    const legal = normalizeText(row.legalForm);
    return legal.includes("srl") || legal.includes("responsabilita limitata");
  }

  function ceeLines(r) {
    const base = r.productionValue ?? r.revenues;
    return [
      metricLine("A) Valore produzione", base, fmtCurrency, "", "total", ratio(base, base)),
      metricLine("B6) Acquisti", r.purchases, fmtCurrency, "", "", ratio(r.purchases, base)),
      metricLine("B7) Servizi", r.services, fmtCurrency, "", "", ratio(r.services, base)),
      metricLine("B8) Godimento beni terzi", r.leases, fmtCurrency, "", "", ratio(r.leases, base)),
      metricLine("B9) Personale", r.personnel, fmtCurrency, "", "", ratio(r.personnel, base)),
      metricLine("MOL", r.ebitda, fmtCurrency, metricClass(r.ebitda), "total", ratio(r.ebitda, base)),
      metricLine("B10) Ammortamenti", r.amortization, fmtCurrency, "", "", ratio(r.amortization, base)),
      metricLine("EBIT", r.ebit, fmtCurrency, metricClass(r.ebit), "total", ratio(r.ebit, base)),
      metricLine("Oneri finanziari", r.financialCharges, fmtCurrency, "", "", ratio(r.financialCharges, base)),
      metricLine("Imposte", r.taxes, fmtCurrency, "", "", ratio(r.taxes, base)),
      metricLine("Risultato netto", r.result, fmtCurrency, metricClass(r.result), "total", ratio(r.result, base))
    ].join("");
  }

  function finiteSum(values) {
    const nums = values.filter(Number.isFinite);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }

  function spCeeLines(r) {
    const base = r.assets;
    const currentAssets = Number.isFinite(r.currentAssets) ? r.currentAssets : finiteSum([r.inventory, r.receivables, r.cash]);
    return [
      metricLine("B) Immobilizzazioni", r.fixedAssets, fmtCurrency, "", "total", ratio(r.fixedAssets, base)),
      metricLine("I. Immateriali", r.intangibleAssets, fmtCurrency, "", "sub", ratio(r.intangibleAssets, base)),
      metricLine("II. Materiali", r.tangibleAssets, fmtCurrency, "", "sub", ratio(r.tangibleAssets, base)),
      metricLine("III. Finanziarie", r.financialFixedAssets, fmtCurrency, "", "sub", ratio(r.financialFixedAssets, base)),
      metricLine("C) Attivo circolante", currentAssets, fmtCurrency, "", "total", ratio(currentAssets, base)),
      metricLine("I. Rimanenze", r.inventory, fmtCurrency, "", "sub", ratio(r.inventory, base)),
      metricLine("II. Crediti", r.receivables, fmtCurrency, "", "sub", ratio(r.receivables, base)),
      metricLine("III. Attività finanziarie", r.currentFinancialAssets, fmtCurrency, "", "sub", ratio(r.currentFinancialAssets, base)),
      metricLine("IV. Disponibilità liquide", r.cash, fmtCurrency, "", "sub", ratio(r.cash, base)),
      metricLine("D) Ratei e risconti attivi", r.assetAccruals, fmtCurrency, "", "", ratio(r.assetAccruals, base)),
      metricLine("Totale attivo netto", r.assets, fmtCurrency, "", "total", ratio(r.assets, base)),
      Number.isFinite(r.assetsGross) ? metricLine("Attivo lordo da situazione contabile", r.assetsGross, fmtCurrency, "", "sub") : "",
      metricLine("A) Patrimonio netto", r.equity, fmtCurrency, "", "total", ratio(r.equity, base)),
      Number.isFinite(r.spBalancingAdjustment)
        ? metricLine("Utile/perdita a quadratura", r.spBalancingAdjustment, fmtCurrency, metricClass(r.spBalancingAdjustment), "sub")
        : "",
      metricLine("B) Fondi rischi e oneri", r.provisions, fmtCurrency, "", "", ratio(r.provisions, base)),
      metricLine("C) TFR", r.employeeTermination, fmtCurrency, "", "", ratio(r.employeeTermination, base)),
      metricLine("D) Debiti", r.debts, fmtCurrency, "", "total", ratio(r.debts, base)),
      metricLine("E) Ratei e risconti passivi", r.liabilityAccruals, fmtCurrency, "", "", ratio(r.liabilityAccruals, base)),
      metricLine("Totale passivo e netto", r.liabilitiesAndEquity, fmtCurrency, "", "total", ratio(r.liabilitiesAndEquity, base))
    ].filter(Boolean).join("");
  }

  function renderAnalysis(rows) {
    if (!rows.length) {
      els.analysisTitle.textContent = "Analisi verticale";
      els.analysisNote.textContent = "Nessun dato disponibile con i filtri attuali.";
      els.verticalView.innerHTML = "";
      els.benchmarkView.innerHTML = `<p class="hint">Seleziona un cliente o un codice ATECO per attivare il confronto.</p>`;
      return;
    }

    if (els.clientFilter.value) {
      renderCompanyAnalysis(rows);
      return;
    }

    if (els.atecoFilter.value) {
      renderAtecoPercentAnalysis(rows);
      return;
    }

    renderPortfolioAnalysis(rows);
  }

  function renderCompanyAnalysis(rows) {
    const ordered = [...rows].sort(yearSort).slice(-4);
    const company = ordered[0]?.clientName || els.clientFilter.value;
    els.analysisTitle.textContent = company;
    els.analysisNote.textContent = "Analisi orizzontale: esercizi in sequenza; percentuali CE sul valore della produzione e percentuali SP sul totale attivo netto.";

    const latest = ordered[ordered.length - 1];
    els.verticalView.innerHTML = comparativeStatementTable("Conto economico", ordered, ceComparativeRows())
      + (isSrl(latest) ? comparativeStatementTable("Stato patrimoniale", ordered, spComparativeRows()) : `<p class="hint">Lo stato patrimoniale comparativo è disponibile per le società di capitali.</p>`)
      + comparativeStatementTable("Indici di bilancio", ordered, indexComparativeRows(), true)
      + (latest ? analyticalAccountTable(latest) : "");

    renderCompanyBenchmark(ordered);
  }

  function ceComparativeRows() {
    return [
      ["A) Valore della produzione", r => r.productionValue ?? r.revenues, "total"],
      ["B6) Acquisti", r => r.purchases], ["B7) Servizi", r => r.services],
      ["B8) Godimento beni di terzi", r => r.leases], ["B9) Personale", r => r.personnel],
      ["MOL", r => r.ebitda, "total"], ["B10) Ammortamenti e svalutazioni", r => r.amortization],
      ["Differenza A-B (EBIT)", r => r.ebit, "total"], ["Oneri finanziari", r => r.financialCharges],
      ["Imposte", r => r.taxes], ["Utile / perdita netta", r => r.result, "total"]
    ].map(([label, value, cls]) => ({ label, value, cls, base: r => r.productionValue ?? r.revenues }));
  }

  function spComparativeRows() {
    const current = r => Number.isFinite(r.currentAssets) ? r.currentAssets : finiteSum([r.inventory, r.receivables, r.currentFinancialAssets, r.cash]);
    return [
      ["ATTIVO", () => null, "section"], ["B) Immobilizzazioni", r => r.fixedAssets, "total"],
      ["I. Immateriali", r => r.intangibleAssets, "sub"], ["II. Materiali", r => r.tangibleAssets, "sub"],
      ["III. Finanziarie", r => r.financialFixedAssets, "sub"], ["C) Attivo circolante", current, "total"],
      ["I. Rimanenze", r => r.inventory, "sub"], ["II. Crediti", r => r.receivables, "sub"],
      ["III. Attività finanziarie", r => r.currentFinancialAssets, "sub"], ["IV. Disponibilità liquide", r => r.cash, "sub"],
      ["D) Ratei e risconti attivi", r => r.assetAccruals], ["Totale attivo netto", r => r.assets, "total"],
      ["PASSIVO E NETTO", () => null, "section"], ["A) Patrimonio netto", r => r.equity, "total"],
      ["B) Fondi rischi e oneri", r => r.provisions], ["C) TFR", r => r.employeeTermination],
      ["D) Debiti", r => r.debts, "total"], ["E) Ratei e risconti passivi", r => r.liabilityAccruals],
      ["Totale passivo e netto", r => r.liabilitiesAndEquity, "total"]
    ].map(([label, value, cls]) => ({ label, value, cls, base: r => r.assets }));
  }

  function indexComparativeRows() {
    return [
      ["ROE", r => r.roe, true], ["ROI", r => r.roi, true], ["ROS", r => r.ros, true],
      ["MOL / valore produzione", r => r.ebitdaMargin, true], ["Utile netto / valore produzione", r => r.margin, true],
      ["Debiti / attivo", r => r.debtRatio, true], ["Indice corrente", r => r.currentRatio, false]
    ].map(([label, value, percent]) => ({ label, value, percent }));
  }

  function comparativeStatementTable(title, rows, definitions, indices = false) {
    const body = definitions.map(def => {
      if (def.cls === "section") return `<tr class="statement-section"><td>${escapeHtml(def.label)}</td>${rows.map(() => "<td></td>").join("")}</tr>`;
      const cells = rows.map((r, i) => {
        const value = def.value(r);
        if (indices) return `<td><strong>${def.percent ? fmtPercent(value) : fmtNumber(value, 2)}</strong></td>`;
        const composition = ratio(value, def.base(r));
        const previous = i ? def.value(rows[i - 1]) : null;
        const change = Number.isFinite(value) && Number.isFinite(previous) && previous !== 0 ? (value - previous) / Math.abs(previous) : null;
        const delta = Number.isFinite(change) ? `<small class="statement-delta ${change > 0 ? "up" : change < 0 ? "down" : ""}">${fmtSignedPercent(change)} a/a</small>` : "";
        return `<td><strong>${fmtCurrency(value)}</strong><small class="statement-pct">Composizione ${fmtPercent(composition)}</small>${delta}</td>`;
      }).join("");
      return `<tr class="${def.cls || ""}"><td>${escapeHtml(def.label)}</td>${cells}</tr>`;
    }).join("");
    const yearWidth = rows.length ? 64 / rows.length : 64;
    return `<section class="statement-block"><h3>${escapeHtml(title)}</h3><div class="table-wrap statement-wrap"><table class="statement-table"><colgroup><col class="statement-label-col" style="width:36%">${rows.map(() => `<col class="statement-year-col" style="width:${yearWidth}%">`).join("")}</colgroup><thead><tr><th>Voce</th>${rows.map(r => `<th>${escapeHtml(r.year)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function deltaMarkup(value, previous, formatter, inverse = false) {
    if (!Number.isFinite(value) || !Number.isFinite(previous)) return "";
    const delta = value - previous;
    const favorable = inverse ? delta < 0 : delta > 0;
    const cls = Math.abs(delta) < 1e-12 ? "" : favorable ? "ok" : "bad";
    const isPercentagePointDelta = formatter === fmtPercent;
    const formatted = isPercentagePointDelta
      ? `${delta > 0 ? "+" : ""}${fmtNumber(delta * 100, 1)}`
      : (previous ? fmtSignedPercent(delta / Math.abs(previous)) : "—");
    const suffix = isPercentagePointDelta ? " p.p." : " a/a";
    return `<small class="comparison-delta ${cls}">${formatted}${suffix}</small>`;
  }

  function renderThreeYearComparison(rows) {
    if (!rows.length) return "";
    const metrics = [
      ["Valore della produzione", "revenues", fmtCurrency, false], ["MOL", "ebitda", fmtCurrency, false],
      ["EBIT", "ebit", fmtCurrency, false], ["Risultato netto", "result", fmtCurrency, false],
      ["Totale attivo netto", "assets", fmtCurrency, false], ["Patrimonio netto", "equity", fmtCurrency, false],
      ["Debiti", "debts", fmtCurrency, true], ["ROE", "roe", fmtPercent, false], ["ROI", "roi", fmtPercent, false],
      ["ROS", "ros", fmtPercent, false], ["MOL / valore produzione", "ebitdaMargin", fmtPercent, false],
      ["Debiti / attivo", "debtRatio", fmtPercent, true], ["Indice corrente", "currentRatio", (v) => fmtNumber(v, 2), false]
    ];
    return `<div class="comparison-block"><h3>Confronto ultimi ${rows.length} esercizi</h3><div class="table-wrap"><table class="comparison-table"><thead><tr><th>Aggregato / indice</th>${rows.map(r=>`<th>${escapeHtml(r.year)}</th>`).join("")}</tr></thead><tbody>${metrics.map(([label,key,formatter,inverse])=>`<tr><td>${escapeHtml(label)}</td>${rows.map((r,i)=>`<td><strong>${formatter(r[key])}</strong>${i?deltaMarkup(r[key],rows[i-1][key],formatter,inverse):""}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  }

  function analyticalAccountTable(record) {
    const accounts = record.analyticalAccounts || [];
    if (!accounts.length) return "";
    return `<details><summary><strong>Dettaglio analitico</strong> · ${accounts.length} voci</summary><div class="table-wrap"><table><thead><tr><th>Prospetto</th><th>Codice conto</th><th>Descrizione</th><th>Classe CEE</th><th>Importo netto</th></tr></thead><tbody>${accounts.map((account) => `<tr><td>${escapeHtml(account.statementType || "CE")}</td><td>${escapeHtml(account.accountCode || "-")}</td><td>${escapeHtml(account.description || "-")}</td><td>${escapeHtml(account.ceeClass || "-")}</td><td>${fmtCurrency(account.netAmount)}</td></tr>`).join("")}</tbody></table></div></details>`;
  }

  function benchmarkAverage(predicate, year, key) {
    return average(state.records.filter((r) => r.year === year && predicate(r)).map((r) => r[key]));
  }

  function renderCompanyBenchmark(rows) {
    const metrics = [
      ["Margine", "margin", fmtPercent, true],
      ["ROE", "roe", fmtPercent, true],
      ["ROI", "roi", fmtPercent, true],
      ["ROS", "ros", fmtPercent, true],
      ["MOL / ricavi", "ebitdaMargin", fmtPercent, true],
      ["Debiti / attivo", "debtRatio", fmtPercent, false],
      ["Ricavi / dip.", "revenuePerEmployee", fmtCurrency, true],
      ["Risultato / dip.", "resultPerEmployee", fmtCurrency, true]
    ];
    const html = rows.map((r) => {
      const sameAteco = (x) => x.ateco && x.ateco === r.ateco;
      const sameGeo = (x) => x.provincia && x.provincia === r.provincia;
      const rowsHtml = metrics.map(([label, key, formatter]) => {
        const sector = benchmarkAverage(sameAteco, r.year, key);
        const geo = benchmarkAverage(sameGeo, r.year, key);
        const delta = Number.isFinite(r[key]) && Number.isFinite(sector) ? r[key] - sector : null;
        return `<tr>
          <td>${escapeHtml(label)}</td>
          <td>${formatter(r[key])}</td>
          <td>${formatter(sector)}</td>
          <td>${formatter(geo)}</td>
          <td class="${metricClass(delta)}">${formatter === fmtPercent ? fmtSignedPercent(delta) : fmtCurrency(delta)}</td>
        </tr>`;
      }).join("");
      return `<div class="year-card">
        <div class="year-head"><strong>Confronto ${escapeHtml(r.year)}</strong><span>settore ATECO e provincia</span></div>
        <table class="benchmark-table">
          <thead><tr><th>Indice</th><th>Azienda</th><th>Media ATECO</th><th>Media provincia</th><th>Delta ATECO</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
    }).join("");
    els.benchmarkView.innerHTML = html || `<p class="hint">Servono altre aziende nello stesso ATECO o nella stessa provincia per calcolare benchmark significativi.</p>`;
  }

  function aggregateYear(items) {
    const revenues = sum(items.map((r) => r.revenues));
    const costs = sum(items.map((r) => r.costs));
    const result = sum(items.map((r) => r.result));
    const assets = sum(items.map((r) => r.assets));
    const debts = sum(items.map((r) => r.debts));
    return {
      count: new Set(items.map((r) => r.clientName)).size,
      costRatio: ratio(costs, revenues),
      resultRatio: ratio(result, revenues),
      debtRatio: ratio(debts, assets),
      avgMargin: average(items.map((r) => r.margin)),
      avgRoe: average(items.map((r) => r.roe)),
      avgRoi: average(items.map((r) => r.roi)),
      avgRos: average(items.map((r) => r.ros)),
      avgEbitdaMargin: average(items.map((r) => r.ebitdaMargin)),
      avgCurrentRatio: average(items.map((r) => r.currentRatio)),
      avgRevenuePerEmployee: average(items.map((r) => r.revenuePerEmployee)),
      avgResultPerEmployee: average(items.map((r) => r.resultPerEmployee))
    };
  }

  function renderAtecoPercentAnalysis(rows) {
    els.analysisTitle.textContent = `Analisi ATECO ${els.atecoFilter.value}`;
    els.analysisNote.textContent = "Vista aggregata: per ATECO vengono mostrati solo valori percentuali e medie degli indici per anno.";
    const groups = byYear(rows);
    els.verticalView.innerHTML = groups.map(({ year, items }) => {
      const a = aggregateYear(items);
      return `<div class="year-card">
        <div class="year-head"><strong>${escapeHtml(year)}</strong><span>${a.count} aziende nel filtro</span></div>
        <div class="metric-grid">
          <div class="metric-group">
            <h3>Aggregati %</h3>
            ${metricLine("Costi / ricavi", a.costRatio, fmtPercent)}
            ${metricLine("Risultato / ricavi", a.resultRatio, fmtPercent, metricClass(a.resultRatio))}
            ${metricLine("Debiti / attivo", a.debtRatio, fmtPercent)}
          </div>
          <div class="metric-group">
            <h3>Medie indici</h3>
            ${metricLine("Margine medio", a.avgMargin, fmtPercent, metricClass(a.avgMargin))}
            ${metricLine("ROE medio", a.avgRoe, fmtPercent, metricClass(a.avgRoe))}
            ${metricLine("ROI medio", a.avgRoi, fmtPercent, metricClass(a.avgRoi))}
            ${metricLine("ROS medio", a.avgRos, fmtPercent, metricClass(a.avgRos))}
            ${metricLine("Indice corrente medio", a.avgCurrentRatio, (v) => fmtNumber(v, 2))}
            ${metricLine("Ricavi / dip. medi", a.avgRevenuePerEmployee)}
          </div>
          <div class="metric-group">
            <h3>Redditivita lavoro</h3>
            ${metricLine("MOL / ricavi medio", a.avgEbitdaMargin, fmtPercent, metricClass(a.avgEbitdaMargin))}
            ${metricLine("Risultato / dip. medio", a.avgResultPerEmployee, fmtCurrency, metricClass(a.avgResultPerEmployee))}
            ${metricLine("Aziende osservate", a.count, fmtNumber)}
          </div>
        </div>
      </div>`;
    }).join("");
    renderSectorGeoBenchmark(rows);
  }

  function renderSectorGeoBenchmark(rows) {
    const sector = aggregateYear(rows);
    const geoGroups = Array.from(new Set(rows.map((r) => r.provincia).filter(Boolean))).sort();
    if (!geoGroups.length) {
      els.benchmarkView.innerHTML = `<p class="hint">Nessuna provincia disponibile per il confronto geografico.</p>`;
      return;
    }
    els.benchmarkView.innerHTML = `<table class="benchmark-table">
      <thead><tr><th>Provincia</th><th>Margine medio</th><th>Debiti/attivo</th><th>Risultato/ricavi</th><th>Aziende</th></tr></thead>
      <tbody>${geoGroups.map((geo) => {
        const a = aggregateYear(rows.filter((r) => r.provincia === geo));
        return `<tr>
          <td>${escapeHtml(geo)}</td>
          <td>${fmtPercent(a.avgMargin)}</td>
          <td>${fmtPercent(a.debtRatio)}</td>
          <td>${fmtPercent(a.resultRatio)}</td>
          <td>${fmtNumber(a.count)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
    <p class="hint">Media complessiva filtro: margine ${fmtPercent(sector.avgMargin)}, debiti/attivo ${fmtPercent(sector.debtRatio)}.</p>`;
  }

  function renderPortfolioAnalysis(rows) {
    els.analysisTitle.textContent = "Portafoglio clienti";
    els.analysisNote.textContent = "Seleziona un cliente per la scheda verticale completa, oppure un ATECO per la vista percentuale aggregata.";
    const groups = byYear(rows);
    els.verticalView.innerHTML = groups.map(({ year, items }) => {
      const revenues = sum(items.map((r) => r.revenues));
      const result = sum(items.map((r) => r.result));
      const a = aggregateYear(items);
      return `<div class="year-card">
        <div class="year-head"><strong>${escapeHtml(year)}</strong><span>${a.count} aziende</span></div>
        <div class="metric-grid">
          <div class="metric-group">
            <h3>Dimensione</h3>
            ${metricLine("Ricavi aggregati", revenues)}
            ${metricLine("Risultato aggregato", result, fmtCurrency, metricClass(result))}
          </div>
          <div class="metric-group">
            <h3>Medie</h3>
            ${metricLine("Margine medio", a.avgMargin, fmtPercent)}
            ${metricLine("Debiti / attivo", a.debtRatio, fmtPercent)}
          </div>
          <div class="metric-group">
            <h3>Normalizzati</h3>
            ${metricLine("Ricavi / dip. medi", a.avgRevenuePerEmployee)}
            ${metricLine("Risultato / dip. medio", a.avgResultPerEmployee)}
          </div>
        </div>
      </div>`;
    }).join("");
    els.benchmarkView.innerHTML = `<p class="hint">Il benchmark azienda vs settore si attiva selezionando un cliente. Il benchmark ATECO/geografia si attiva selezionando un codice ATECO.</p>`;
  }

  function renderTable(rows) {
    if (!rows.length) {
      els.rowsBody.innerHTML = `<tr><td colspan="19">Nessun dato con i filtri attuali.</td></tr>`;
      return;
    }
    const ordered = [...rows].sort((a, b) => a.clientName.localeCompare(b.clientName, "it") || String(a.year).localeCompare(String(b.year)));
    els.rowsBody.innerHTML = ordered.map((r) => `
      <tr>
        <td>${escapeHtml(r.clientName)}<br><small>${escapeHtml(r.legalForm || r.comune || r.fileName)}</small></td>
        <td>${escapeHtml(r.year)}</td>
        <td>${escapeHtml(r.ateco)}</td>
        <td>${escapeHtml(r.provincia)}</td>
        <td>${fmtNumber(r.employees)}</td>
        <td>${fmtCurrency(r.revenues)}</td>
        <td>${fmtCurrency(r.revenuePerEmployee)}</td>
        <td>${fmtCurrency(r.costs)}</td>
        <td class="${metricClass(r.ebitda)}">${fmtCurrency(r.ebitda)}</td>
        <td class="${metricClass(r.result)}">${fmtCurrency(r.result)}</td>
        <td class="${metricClass(r.resultPerEmployee)}">${fmtCurrency(r.resultPerEmployee)}</td>
        <td class="${metricClass(r.roe)}">${fmtPercent(r.roe)}</td>
        <td class="${metricClass(r.roi)}">${fmtPercent(r.roi)}</td>
        <td class="${metricClass(r.ros)}">${fmtPercent(r.ros)}</td>
        <td class="${metricClass(r.margin)}">${fmtPercent(r.margin)}</td>
        <td>${fmtCurrency(r.assets)}</td>
        <td>${fmtCurrency(r.debts)}</td>
        <td>${fmtPercent(r.debtRatio)}</td>
        <td><span title="${escapeHtml(r.sourcePath || '')}">${escapeHtml(r.fileName)}</span></td>
      </tr>
    `).join("");
  }

  function grouped(rows, keyFn, valueFn) {
    const map = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      const value = valueFn(row);
      if (!key || !Number.isFinite(value)) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    }
    return Array.from(map, ([key, values]) => ({ key, values, value: values.reduce((a, b) => a + b, 0) }));
  }

  function renderBars(container, title, data, formatter) {
    const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
    container.innerHTML = `<strong>${escapeHtml(title)}</strong>`;
    if (!data.length) {
      container.innerHTML += `<p class="hint">Dati non disponibili.</p>`;
      return;
    }
    container.innerHTML += data.map((d) => `
      <div class="bar-row">
        <div>${escapeHtml(d.key)}</div>
        <div class="bar-track"><div class="bar" style="width:${Math.min(100, Math.abs(d.value) / max * 100)}%"></div></div>
        <div>${formatter(d.value)}</div>
      </div>
    `).join("");
  }

  function lineChart(title, rows, series, formatter) {
    const valid = series.flatMap(s=>rows.map(r=>r[s.key])).filter(Number.isFinite);
    if (!valid.length) return `<div><strong>${escapeHtml(title)}</strong><p class="hint">Dati non disponibili.</p></div>`;
    const min=Math.min(0,...valid),max=Math.max(...valid),span=max-min||1,w=620,h=230,p=34,dx=rows.length>1?(w-2*p)/(rows.length-1):0;
    const y=v=>h-p-((v-min)/span)*(h-2*p), x=i=>p+i*dx;
    const colors=["#006aa6","#147a46","#b42318","#8a5a00","#6f42c1"];
    const paths=series.map((s,si)=>{const pts=rows.map((r,i)=>Number.isFinite(r[s.key])?`${x(i)},${y(r[s.key])}`:null).filter(Boolean);return pts.length?`<polyline fill="none" stroke="${colors[si%colors.length]}" stroke-width="2.5" points="${pts.join(" ")}"/>${rows.map((r,i)=>Number.isFinite(r[s.key])?`<circle cx="${x(i)}" cy="${y(r[s.key])}" r="3" fill="${colors[si%colors.length]}"><title>${escapeHtml(s.label)} ${escapeHtml(r.year)}: ${formatter(r[s.key])}</title></circle><text class="point-value" x="${x(i)}" y="${y(r[s.key]) + (si === 0 ? -8 : 12 + (si - 1) * 12)}" text-anchor="middle" fill="${colors[si%colors.length]}">${escapeHtml(fmtCompactCurrency(r[s.key]))}</text>`:"").join("")}`:""}).join("");
    return `<div class="time-chart"><strong>${escapeHtml(title)}</strong><div class="chart-legend">${series.map((s,i)=>{const mean=average(rows.map(r=>r[s.key]));return `<span><i style="background:${colors[i%colors.length]}"></i>${escapeHtml(s.label)} · media ${formatter(mean)}</span>`;}).join("")}</div><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(title)}"><line x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}" stroke="#b9c6d5"/>${rows.map((r,i)=>`<text x="${x(i)}" y="${h-10}" text-anchor="middle">${escapeHtml(r.year)}</text>`).join("")}${paths}</svg></div>`;
  }

  function pieChart(title, items, total) {
    const colors = ["#006aa6", "#46a5d1", "#147a46", "#8a5a00", "#b42318", "#6f42c1"];
    const valid = items.filter(item => Number.isFinite(item.value) && item.value > 0 && Number.isFinite(total) && total > 0);
    let cursor = 0;
    const slices = valid.map((item, i) => {
      const start = cursor;
      cursor += item.value / total * 100;
      return `${colors[i % colors.length]} ${start}% ${Math.min(cursor, 100)}%`;
    });
    if (!valid.length) return `<div class="pie-card"><strong>${escapeHtml(title)}</strong><p class="hint">Dati non disponibili.</p></div>`;
    return `<div class="pie-card"><strong>${escapeHtml(title)}</strong><div class="pie-layout"><div class="pie" style="background:conic-gradient(${slices.join(",")})" role="img" aria-label="${escapeHtml(title)}"></div><div class="pie-legend">${valid.map((item,i)=>`<div><i style="background:${colors[i%colors.length]}"></i><span>${escapeHtml(item.label)}</span><strong>${fmtPercent(item.value/total)}</strong></div>`).join("")}</div></div></div>`;
  }

  function indexBarChart(title, rows, series) {
    const values = series.flatMap(s => rows.map(r => r[s.key])).filter(Number.isFinite);
    if (!values.length) return `<div class="time-chart"><strong>${escapeHtml(title)}</strong><p class="hint">Dati non disponibili.</p></div>`;
    const colors=["#006aa6","#147a46","#b42318","#8a5a00","#6f42c1"], w=680,h=270,p=38;
    const min=Math.min(0,...values),max=Math.max(0,...values),span=max-min||1;
    const y=v=>h-p-((v-min)/span)*(h-2*p), zero=y(0), groupW=(w-2*p)/rows.length, barW=Math.min(18,(groupW-12)/series.length);
    const bars=rows.map((r,ri)=>series.map((s,si)=>{const v=r[s.key];if(!Number.isFinite(v))return "";const bx=p+ri*groupW+(groupW-series.length*barW)/2+si*barW,by=Math.min(y(v),zero),bh=Math.max(1,Math.abs(y(v)-zero));return `<rect x="${bx}" y="${by}" width="${Math.max(2,barW-2)}" height="${bh}" fill="${colors[si%colors.length]}"><title>${escapeHtml(s.label)} ${escapeHtml(r.year)}: ${fmtPercent(v)}</title></rect>`;}).join("")).join("");
    return `<div class="time-chart"><strong>${escapeHtml(title)}</strong><div class="chart-legend">${series.map((s,i)=>`<span><i style="background:${colors[i%colors.length]}"></i>${escapeHtml(s.label)}</span>`).join("")}</div><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(title)}"><line x1="${p}" y1="${zero}" x2="${w-p}" y2="${zero}" stroke="#9aa9ba"/>${bars}${rows.map((r,i)=>`<text x="${p+i*groupW+groupW/2}" y="${h-10}" text-anchor="middle">${escapeHtml(r.year)}</text>`).join("")}</svg></div>`;
  }

  function singleIndexBarChart(rows, series, color) {
    const values=rows.map(r=>r[series.key]).filter(Number.isFinite);
    if(!values.length)return "";
    const mean=average(values),w=310,h=205,p=34,min=Math.min(0,...values),max=Math.max(0,...values),span=max-min||1;
    const y=v=>h-p-((v-min)/span)*(h-2*p),zero=y(0),groupW=(w-2*p)/rows.length,barW=Math.min(38,groupW*.55);
    const bars=rows.map((r,i)=>{const v=r[series.key];if(!Number.isFinite(v))return "";const bx=p+i*groupW+(groupW-barW)/2,by=Math.min(y(v),zero),bh=Math.max(1,Math.abs(y(v)-zero));return `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="2" fill="${color}"><title>${escapeHtml(r.year)}: ${fmtPercent(v)}</title></rect><text x="${bx+barW/2}" y="${Math.max(13,by-5)}" text-anchor="middle" fill="${color}">${fmtPercent(v)}</text>`;}).join("");
    const meanY=y(mean);
    return `<div class="index-chart"><strong>${escapeHtml(series.label)}</strong><span class="index-average">Media ${fmtPercent(mean)}</span><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Evoluzione ${escapeHtml(series.label)}"><line x1="${p}" y1="${zero}" x2="${w-p}" y2="${zero}" stroke="#9aa9ba"/><line x1="${p}" y1="${meanY}" x2="${w-p}" y2="${meanY}" stroke="#455468" stroke-width="1.5" stroke-dasharray="5 4"><title>Media: ${fmtPercent(mean)}</title></line>${bars}${rows.map((r,i)=>`<text x="${p+i*groupW+groupW/2}" y="${h-10}" text-anchor="middle">${escapeHtml(r.year)}</text>`).join("")}</svg></div>`;
  }

  function singleIndexCharts(rows, series) {
    const colors=["#006aa6","#147a46","#b42318","#8a5a00","#6f42c1"];
    return `<div class="index-charts-title">Evoluzione principali indici</div><div class="index-chart-grid">${series.map((s,i)=>singleIndexBarChart(rows,s,colors[i%colors.length])).join("")}</div>`;
  }

  function renderTrend(rows) {
    if (els.clientFilter.value) {
      const ordered=[...rows].sort(yearSort).slice(-4), latest=ordered[ordered.length-1];
      const currentAssets = Number.isFinite(latest?.currentAssets) ? latest.currentAssets : finiteSum([latest?.inventory,latest?.receivables,latest?.currentFinancialAssets,latest?.cash]);
      els.trendChart.innerHTML = lineChart("Evoluzione economica",ordered,[{key:"revenues",label:"Valore della produzione"},{key:"ebit",label:"Differenza A-B"},{key:"result",label:"Utile netto"}],fmtCurrency)
        + `<div class="pie-grid">${pieChart(`Composizione attivo ${latest?.year || ""}`,[{label:"Immobilizzazioni",value:latest?.fixedAssets},{label:"Attivo circolante",value:currentAssets},{label:"Ratei e risconti",value:latest?.assetAccruals}],latest?.assets)}${pieChart(`Composizione passivo ${latest?.year || ""}`,[{label:"Patrimonio netto",value:latest?.equity},{label:"Fondi rischi",value:latest?.provisions},{label:"TFR",value:latest?.employeeTermination},{label:"Debiti",value:latest?.debts},{label:"Ratei e risconti",value:latest?.liabilityAccruals}],latest?.assets)}</div>`
        + singleIndexCharts(ordered,[{key:"roe",label:"ROE"},{key:"roi",label:"ROI"},{key:"ros",label:"ROS"},{key:"ebitdaMargin",label:"MOL / valore produzione"},{key:"debtRatio",label:"Debiti / attivo"}]);
      return;
    }
    const data = grouped(rows, (r) => r.year, (r) => r.revenues).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    renderBars(els.trendChart, "Valore della produzione per annualità", data, fmtCurrency);
  }

  function renderAteco(rows) {
    const data = grouped(rows, (r) => r.ateco, (r) => r.margin)
      .map((d) => ({ ...d, value: average(d.values) }))
      .filter((d) => Number.isFinite(d.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    renderBars(els.atecoChart, "Margine medio per ATECO", data, fmtPercent);
  }

  function exportCsv() {
    const headers = ["cliente", "anno", "ateco", "cap", "comune", "provincia", "forma_giuridica", "dipendenti", "ricavi", "ricavi_per_dipendente", "costi", "acquisti", "servizi", "godimento_beni_terzi", "personale", "mol", "mol_ricavi", "ammortamenti", "ebit", "roe", "roi", "ros", "costi_per_dipendente", "risultato", "risultato_per_dipendente", "margine", "attivo", "debiti", "debiti_attivo", "crediti", "liquidita", "rimanenze", "patrimonio_netto", "file"];
    const lines = [headers.join(";")];
    for (const r of state.filtered) {
      const row = {
        cliente: r.clientName, anno: r.year, ateco: r.ateco, cap: r.cap, comune: r.comune, provincia: r.provincia,
        forma_giuridica: r.legalForm, dipendenti: r.employees, ricavi: r.revenues, ricavi_per_dipendente: r.revenuePerEmployee,
        costi: r.costs, acquisti: r.purchases, servizi: r.services, godimento_beni_terzi: r.leases, personale: r.personnel,
        mol: r.ebitda, mol_ricavi: r.ebitdaMargin, ammortamenti: r.amortization, ebit: r.ebit, roe: r.roe, roi: r.roi, ros: r.ros,
        costi_per_dipendente: r.costsPerEmployee, risultato: r.result, risultato_per_dipendente: r.resultPerEmployee,
        margine: r.margin, attivo: r.assets, debiti: r.debts, debiti_attivo: r.debtRatio, crediti: r.receivables,
        liquidita: r.cash, rimanenze: r.inventory, patrimonio_netto: r.equity, file: r.fileName
      };
      lines.push(headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(";"));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "analisi-bilanci.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetFilters() {
    els.clientFilter.value = "";
    els.atecoFilter.value = "";
    els.geoFilter.value = "";
    els.comuneFilter.value = "";
    els.yearFilter.value = "";
    els.employeeClassFilter.value = "";
    els.revenueClassFilter.value = "";
    applyFilters();
  }

  els.loadBtn.addEventListener("click", loadData);
  els.saveProjectBtn.addEventListener("click", () => saveProject(true));
  els.exportBtn.addEventListener("click", exportCsv);
  els.resetBtn.addEventListener("click", resetFilters);
  [els.clientFilter, els.atecoFilter, els.geoFilter, els.comuneFilter, els.yearFilter, els.employeeClassFilter, els.revenueClassFilter].forEach((el) => el.addEventListener("change", applyFilters));

  async function initialize() {
    initDefaults();
    await loadProject();
    state.projectReady = true;
    await loadData();
  }

  initialize();
})();
