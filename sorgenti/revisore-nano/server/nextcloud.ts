import { ENV } from "./_core/env";
import { execFileSync } from "node:child_process";

const OCS_API_SUFFIX = "/ocs/v2.php/apps/files_sharing/api/v1/shares";

type NextcloudConfig = {
  baseUrl: string;
  user: string;
  pass: string;
  rootFolder: string;
};

function getNextcloudConfig(): NextcloudConfig | null {
  if (!ENV.nextcloudUrl || !ENV.nextcloudUser || !ENV.nextcloudPass) {
    return null;
  }

  return {
    baseUrl: ENV.nextcloudUrl.replace(/\/+$/, ""),
    user: ENV.nextcloudUser,
    pass: ENV.nextcloudPass,
    rootFolder: ENV.nextcloudRootFolder.replace(/^\/+|\/+$/g, ""),
  };
}

function getAuthHeaders(config: NextcloudConfig, extra: HeadersInit = {}) {
  const token = Buffer.from(`${config.user}:${config.pass}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    ...extra,
  };
}

function encodePathSegments(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

function normalizeRelativePath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (normalized.split("/").some(part => part === "..")) {
    throw new Error("Percorso Nextcloud non valido");
  }
  return normalized;
}

export type NextcloudFileEntry = {
  path: string;
  name: string;
  etag: string | null;
  size: number | null;
  lastModified: string | null;
  contentType: string | null;
};

export type NextcloudDirectoryEntry = NextcloudFileEntry & { isFolder: boolean };

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function xmlValue(block: string, localName: string): string | null {
  const match = block.match(new RegExp(`<[^>]*${localName}[^>]*>([\\s\\S]*?)<\\/[^>]*${localName}>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

/** Elenca un solo livello: base del selettore visuale e della scansione progressiva. */
export async function listNextcloudDirectory(relativeFolder: string): Promise<NextcloudDirectoryEntry[]> {
  const config = getNextcloudConfig();
  if (!config) throw new Error("Integrazione Nextcloud non configurata");

  const requested = normalizeRelativePath(relativeFolder);
  // Le cartelle sorgente (es. Revisioni/MM) sono relative alla home Nextcloud,
  // indipendenti dalla root tecnica usata dall'app per i propri output.
  const rootRelative = requested;
  const baseDavPath = `/remote.php/dav/files/${encodeURIComponent(config.user)}/`;
  const folderUrl = `${config.baseUrl}${baseDavPath}${encodePathSegments(rootRelative)}`;
  const response = await fetch(folderUrl, {
    method: "PROPFIND",
    headers: getAuthHeaders(config, {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    }),
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/></d:prop></d:propfind>`,
  });
  if (!response.ok && response.status !== 207) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Lettura cartella Nextcloud fallita (${response.status}): ${detail.slice(0, 300)}`);
  }

  const xml = await response.text();
  const blocks = xml.match(/<[^>]*response[^>]*>[\s\S]*?<\/[^>]*response>/gi) ?? [];
  const entries: NextcloudDirectoryEntry[] = [];
  for (const block of blocks) {
    const href = xmlValue(block, "href");
    if (!href) continue;
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(href, config.baseUrl).pathname); } catch { continue; }
    const davPrefix = `/remote.php/dav/files/${config.user}/`;
    const prefixIndex = pathname.indexOf(davPrefix);
    if (prefixIndex < 0) continue;
    const fullRelative = pathname.slice(prefixIndex + davPrefix.length).replace(/^\/+/, "");
    const path = fullRelative;
    const name = path.split("/").pop() || path;
    if (path.replace(/\/+$/, "") === requested.replace(/\/+$/, "")) continue;
    entries.push({
      path,
      name,
      isFolder: /<[^>]*collection\s*\/?>/i.test(block),
      etag: xmlValue(block, "getetag")?.replace(/^\"|\"$/g, "") ?? null,
      size: Number(xmlValue(block, "getcontentlength")) || null,
      lastModified: xmlValue(block, "getlastmodified"),
      contentType: xmlValue(block, "getcontenttype"),
    });
  }
  return entries.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, "it"));
}

/** Elenca ricorsivamente con richieste brevi Depth:1 per evitare timeout 524. */
export async function listNextcloudFiles(
  relativeFolder: string,
  maxFiles = 2000
): Promise<NextcloudFileEntry[]> {
  const queue = [normalizeRelativePath(relativeFolder)];
  const visited = new Set<string>();
  const files: NextcloudFileEntry[] = [];
  while (queue.length && files.length < maxFiles) {
    const folder = queue.shift()!;
    if (visited.has(folder)) continue;
    visited.add(folder);
    const children = await listNextcloudDirectory(folder);
    for (const child of children) {
      if (child.isFolder) queue.push(child.path);
      else files.push({ path: child.path, name: child.name, etag: child.etag, size: child.size, lastModified: child.lastModified, contentType: child.contentType });
      if (files.length >= maxFiles) break;
    }
  }
  return files;
}

/** Scarica un file attraverso WebDAV autenticato, senza generare link pubblici. */
export async function downloadNextcloudFile(relativePath: string): Promise<Buffer> {
  const config = getNextcloudConfig();
  if (!config) throw new Error("Integrazione Nextcloud non configurata");
  const normalized = normalizeRelativePath(relativePath);
  const fullRelative = normalized;
  const url = `${config.baseUrl}/remote.php/dav/files/${encodeURIComponent(config.user)}/${encodePathSegments(fullRelative)}`;
  const response = await fetch(url, { method: "GET", headers: getAuthHeaders(config) });
  if (!response.ok) {
    throw new Error(`Download Nextcloud fallito (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function analyzeRevisionFolderLocally(relativeFolder: string, engagementYear?: number): Promise<Record<string, any>> {
  const folder = normalizeRelativePath(relativeFolder);
  const files = await listNextcloudFiles(folder);
  const year = engagementYear ?? new Date().getFullYear();
  const source = (file: NextcloudFileEntry) => ({
    path: file.path,
    name: file.name,
    extension: file.name.split(".").pop()?.toLocaleLowerCase("it-IT") ?? "",
    requiresOcr: /\.pdf$/i.test(file.name),
  });
  // La classificazione usa il solo nome del file: i nomi delle sottocartelle
  // (es. "Circolarizzazioni clienti e fornitori") non devono contaminare il ruolo.
  const normalizedName = (file: NextcloudFileEntry) => file.name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT");
  const yearsOf = (file: NextcloudFileEntry) => {
    const value = file.path.toLocaleLowerCase("it-IT");
    const fourDigits = (value.match(/(?:19|20)\d{2}/g) ?? []).map(Number);
    const twoDigits = Array.from(value.matchAll(/(?:^|[^0-9])(2[0-9])(?:[^0-9]|$)/g)).map(match => 2000 + Number(match[1]));
    return Array.from(new Set([...fourDigits, ...twoDigits]));
  };
  const relatesToYear = (file: NextcloudFileEntry, wanted: number) => {
    const years = yearsOf(file);
    return years.length === 0 || years.includes(wanted);
  };
  const pick = (predicate: (name: string, file: NextcloudFileEntry) => boolean, wantedYear = year) => files
    .filter(file => predicate(normalizedName(file), file) && relatesToYear(file, wantedYear))
    .map(source);

  const isInterim = (name: string) => /infrannual|provvisor|trimestr|semestr|(?:bilancio|situazione).{0,30}(?:31\D+0?3|30\D+0?[69])|(?:31\D+0?3|30\D+0?[69]).{0,30}(?:bilancio|situazione)/.test(name);
  const isAnalytical = (name: string) => /bilancio.{0,10}(?:di )?verifica|bilancio analitico|situazione contabile/.test(name);
  const isBalance = (name: string) => /bilancio|xbrl|situazione contabile/.test(name);
  const docs: Record<string, ReturnType<typeof source>[]> = {
    bilancioXbrl: pick((name, file) => /\.xbrl$/i.test(file.name) && !isInterim(name)),
    bilancioCivilistico: pick((name, file) => /\.pdf$/i.test(file.name) && isBalance(name) && !isAnalytical(name) && !isInterim(name) && !/nota integrativa|verbale|relazione/.test(name)),
    bilancioAnalitico: pick((name) => isAnalytical(name) && !isInterim(name)),
    notaIntegrativa: pick((name) => /nota integrativa/.test(name)),
    clienti: pick((name, file) => /client[ei]/.test(name) && (/\.(?:xlsx?|xlsm|csv)$/i.test(file.name) || /partitar|scadenz|mastro/.test(name))),
    fornitori: pick((name, file) => /fornitor/.test(name) && (/\.(?:xlsx?|xlsm|csv)$/i.test(file.name) || /partitar|scadenz|mastro/.test(name))),
    partitarioGenerale: pick((name, file) => /\.(?:xlsx?|xlsm|csv|pdf)$/i.test(file.name) && /partitario|libro mastro|mastro generale|movimenti contabili/.test(name) && !/client[ei]|fornitor/.test(name)),
    estrattiContoSuccessivi: files.filter(file => {
      const name = normalizedName(file);
      const fullPath = file.path.toLocaleLowerCase("it-IT");
      if (!/movimenti bancari|\bec(?:\s|_|-)|conto corrente/.test(name) && !/estratt[oi].{0,8}conto/.test(name)) return false;
      if (/circolarizzaz/.test(fullPath) && !/\bec(?:\s|_|-)/.test(name)) return false;
      const foundYears = yearsOf(file);
      return foundYears.length === 0 || foundYears.some(found => found > year);
    }).map(source),
    durc: files.filter(file => /\bdurc\b/.test(normalizedName(file))).map(source),
    registroCespiti: pick((name) => /registro cespiti|beni ammortizzabili|libro cespiti/.test(name)),
    centraleRischi: pick((name) => /centrale.{0,8}rischi|bankitalia|banca d.italia/.test(name)),
  };

  const balanceCandidates = files.filter(file => isBalance(normalizedName(file)) && !/nota integrativa/.test(normalizedName(file)));
  const historicalBalances = balanceCandidates.flatMap(file => yearsOf(file)
    .filter(found => found < year)
    .map(found => ({ path: file.path, name: file.name, year: found, values: { ricavi: null, totaleAttivo: null, patrimonioNetto: null } })))
    .filter((item, index, all) => all.findIndex(other => other.path === item.path && other.year === item.year) === index)
    .sort((a, b) => b.year - a.year);
  const referenceDate = (name: string, foundYear: number) => {
    const match = name.match(/\b(31|30|3[01])[-_. /](0?[1369]|12)(?:[-_. /](20\d{2}))?/);
    if (!match) return null;
    return `${Number(match[3] ?? foundYear)}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
  };
  const interimBalances = files.filter(file => isBalance(normalizedName(file)) && isInterim(normalizedName(file))).map(file => ({
    path: file.path,
    name: file.name,
    year: yearsOf(file).find(found => found === year) ?? year,
    referenceDate: referenceDate(normalizedName(file), year),
    values: { ricavi: null, totaleAttivo: null, patrimonioNetto: null },
  }));
  const durc = files.filter(file => /\bdurc\b/.test(normalizedName(file))).map(file => {
    const name = normalizedName(file);
    const match = name.match(/(?:scad(?:enza)?\.?\s*)?(\d{1,2})[-_. /](\d{1,2})[-_. /](20\d{2})/);
    const expiryDate = match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
    return { path: file.path, name: file.name, expiryDate, coversYearEnd: expiryDate ? expiryDate >= `${year}-12-31` : false };
  });

  const identityFile = files.find(file => /visura|registro imprese/.test(normalizedName(file)) && /\.pdf$/i.test(file.name));
  let identityText = "";
  if (identityFile) {
    try {
      const pdf = await downloadNextcloudFile(identityFile.path);
      identityText = execFileSync("pdftotext", ["-layout", "-", "-"], { input: pdf, maxBuffer: 12 * 1024 * 1024 }).toString("utf8");
    } catch { /* Il nome cartella resta una fonte anagrafica utilizzabile. */ }
  }
  const textValue = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = identityText.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim().replace(/\s{2,}.*/, "");
    }
    return null;
  };
  const folderName = folder.split("/").filter(Boolean).pop() ?? folder;
  const ragioneSociale = textValue([
    /denominazione\s*[:\n]?\s*([^\n]+)/i,
    /ragione sociale\s*[:\n]?\s*([^\n]+)/i,
  ]) ?? folderName;
  const legalName = ragioneSociale.toLocaleLowerCase("it-IT");
  const formaGiuridica = /s\.?(?:r|a)\.?l\.?\s+unipersonale|srl\s+unipersonale/.test(legalName) ? "srl_unipersonale"
    : /s\.?r\.?l\.?/.test(legalName) ? "srl" : /s\.?p\.?a\.?/.test(legalName) ? "spa"
    : /s\.?n\.?c\.?/.test(legalName) ? "snc" : /s\.?a\.?s\.?/.test(legalName) ? "sas" : "altro";
  const codiceFiscale = textValue([/codice fiscale\s*[:\n]?\s*([A-Z0-9]{11,16})/i]);
  const partitaIva = textValue([/partita iva\s*[:\n]?\s*(\d{11})/i]);

  const missingDocuments = [
    ["bilancio XBRL", docs.bilancioXbrl], ["bilancio civilistico PDF", docs.bilancioCivilistico],
    ["bilancio analitico", docs.bilancioAnalitico], ["partitario clienti", docs.clienti],
    ["partitario fornitori", docs.fornitori], ["estratti conto successivi", docs.estrattiContoSuccessivi],
  ].filter(([, values]) => !(values as unknown[]).length).map(([label]) => label as string);
  const stages = [
    { id: "anagrafica", order: 1, title: "Anagrafica, incarico e comprensione dell'impresa", status: identityFile ? "disponibile" : "in_attesa", automaticChecks: ["Lettura visura e documenti societari"] },
    { id: "coerenza", order: 2, title: "Analisi preliminare e coerenza storica", status: balanceCandidates.length ? "disponibile" : "in_attesa", automaticChecks: ["Confronto dell'esercizio con i due precedenti", "Individuazione degli scostamenti"] },
    { id: "priorita", order: 3, title: "Significatività e priorità delle aree", status: docs.bilancioXbrl.length || docs.bilancioAnalitico.length ? "disponibile" : "in_attesa", automaticChecks: ["Peso sul totale attivo e sul valore della produzione"] },
    { id: "quadrature", order: 4, title: "Quadrature contabili", status: docs.partitarioGenerale.length || docs.clienti.length || docs.fornitori.length ? "disponibile" : "in_attesa", automaticChecks: ["Bilancio-partitari", "Clienti e fornitori"] },
    { id: "successivi", order: 5, title: "Incassi e pagamenti successivi", status: docs.estrattiContoSuccessivi.length ? "disponibile" : "in_attesa", automaticChecks: ["Abbinamento movimenti bancari e partite"] },
    { id: "circolarizzazioni", order: 6, title: "Circolarizzazioni e procedure alternative", status: docs.clienti.length || docs.fornitori.length ? "disponibile" : "in_attesa", automaticChecks: ["Selezione per copertura", "Verifica risposte"] },
  ];
  const categories = {
    bilanci: balanceCandidates.length,
    visure: files.filter(file => /visura|registro imprese/.test(normalizedName(file))).length,
    durc: durc.length,
    partitari: files.filter(file => /partitar|libro mastro/.test(normalizedName(file))).length,
    estrattiConto: docs.estrattiContoSuccessivi.length,
    verbali: files.filter(file => /verbale|assemblea|consiglio amministrazione|\bcda\b/.test(normalizedName(file))).length,
    altro: 0,
  };
  categories.altro = Math.max(0, files.length - Object.values(categories).reduce((sum, value) => sum + value, 0));

  return {
    folder,
    identitySource: identityFile?.name ?? "nome della cartella selezionata",
    totalFiles: files.length,
    years: Array.from(new Set(files.flatMap(yearsOf))).sort((a, b) => b - a),
    categories,
    profile: { ragioneSociale, codiceFiscale, partitaIva, formaGiuridica, settore: null, comune: null, provincia: null },
    auditPackage: { historicalBalances, interimBalances, durc, missingDocuments },
    standardPackage: { documents: docs, stages },
    parser: { engine: "revisore-nano-locale", version: "2.0", externalService: false },
  };
}

async function ensureFolder(
  config: NextcloudConfig,
  relativeFolder: string
): Promise<void> {
  const parts = relativeFolder.split("/").filter(Boolean);
  let currentPath = "";

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const folderUrl = `${config.baseUrl}/remote.php/dav/files/${encodeURIComponent(
      config.user
    )}/${encodePathSegments(currentPath)}`;
    const response = await fetch(folderUrl, {
      method: "MKCOL",
      headers: getAuthHeaders(config),
    });

    if (![201, 301, 405].includes(response.status)) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(
        `Nextcloud MKCOL failed (${response.status}): ${message}`
      );
    }
  }
}

async function getExistingShareUrl(
  config: NextcloudConfig,
  fullPath: string
): Promise<string | null> {
  const query = new URLSearchParams({
    format: "json",
    path: fullPath,
    reshares: "true",
  });
  const response = await fetch(
    `${config.baseUrl}${OCS_API_SUFFIX}?${query.toString()}`,
    {
      method: "GET",
      headers: getAuthHeaders(config, {
        Accept: "application/json",
        "OCS-APIRequest": "true",
      }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        ocs?: {
          data?: Array<{ url?: string }>;
        };
      }
    | null;

  const firstUrl = payload?.ocs?.data?.[0]?.url;
  return typeof firstUrl === "string" && firstUrl.length > 0 ? firstUrl : null;
}

function toDirectDownloadUrl(shareUrl: string): string {
  return shareUrl.endsWith("/") ? `${shareUrl}download` : `${shareUrl}/download`;
}

export async function uploadToNextcloud(
  relPath: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ webdavPath: string; publicUrl: string } | null> {
  const config = getNextcloudConfig();
  if (!config) {
    return null;
  }

  const normalizedPath = normalizeRelativePath(relPath);
  const fullPath = `/${config.rootFolder}/${normalizedPath}`;
  const folderPath = `${config.rootFolder}/${normalizedPath.split("/").slice(0, -1).join("/")}`;

  await ensureFolder(config, folderPath);

  const uploadUrl = `${config.baseUrl}/remote.php/dav/files/${encodeURIComponent(
    config.user
  )}/${encodePathSegments(fullPath)}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: getAuthHeaders(config, {
      "Content-Type": contentType,
    }),
    body: typeof data === "string" ? Buffer.from(data) : Buffer.from(data),
  });

  if (!uploadResponse.ok) {
    const message = await uploadResponse.text().catch(() => uploadResponse.statusText);
    throw new Error(
      `Nextcloud upload failed (${uploadResponse.status}): ${message}`
    );
  }

  let shareUrl = await getExistingShareUrl(config, fullPath);

  if (!shareUrl) {
    const body = new URLSearchParams({
      path: fullPath,
      shareType: "3",
      permissions: "1",
    });
    const shareResponse = await fetch(
      `${config.baseUrl}${OCS_API_SUFFIX}?format=json`,
      {
        method: "POST",
        headers: getAuthHeaders(config, {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "OCS-APIRequest": "true",
        }),
        body,
      }
    );

    if (shareResponse.ok) {
      const payload = (await shareResponse.json().catch(() => null)) as
        | {
            ocs?: {
              data?: { url?: string };
            };
          }
        | null;
      shareUrl = payload?.ocs?.data?.url ?? null;
    } else {
      shareUrl = await getExistingShareUrl(config, fullPath);
    }
  }

  if (!shareUrl) {
    throw new Error("Nextcloud share URL not available after upload");
  }

  return {
    webdavPath: fullPath,
    publicUrl: toDirectDownloadUrl(shareUrl),
  };
}

export async function getNextcloudDownloadUrl(
  relPath: string
): Promise<string | null> {
  const config = getNextcloudConfig();
  if (!config) {
    return null;
  }

  const fullPath = `/${config.rootFolder}/${normalizeRelativePath(relPath)}`;
  const shareUrl = await getExistingShareUrl(config, fullPath);
  return shareUrl ? toDirectDownloadUrl(shareUrl) : null;
}
