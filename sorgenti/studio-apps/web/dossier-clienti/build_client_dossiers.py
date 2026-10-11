#!/usr/bin/env python3
import datetime as dt
import hashlib
import importlib.util
import json
import re
import sys
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

DATA_ROOT = Path('/var/www/html/data/admin/files')
PRIVATE_DIR = DATA_ROOT / 'Studio' / 'DossierClienti' / 'private'
OUTPUT = PRIVATE_DIR / 'dossier-index.json'
LIST_OUTPUT = PRIVATE_DIR / 'dossier-client-list.json'
HISTORICAL_TAX_QUEUE = PRIVATE_DIR / 'historical-tax-extraction-queue.json'
ANALYTICS = Path('/var/www/html/studio-apps/bilanci-analytics/analytics-data.json')
ANON_MODULE = Path('/var/www/html/studio-apps/bilanci-anonimizzati/auto_anonymize.py')
VISURE_DIR = DATA_ROOT / 'studio-example' / 'archivio studio-example' / 'VISURE'
IDENTITY_DOCUMENTS_DIR = DATA_ROOT / 'studio-example' / 'archivio studio-example' / "Documenti d'identità"
VISURE_STATE = PRIVATE_DIR / 'visure-state.json'
UNICO_2025_ROOT = DATA_ROOT / 'studio-example' / 'archivio studio-example' / 'LAVORI studio-example' / 'studio-example LAVORI 2025'
UNICO_2025_DIRS = {
    'pf': UNICO_2025_ROOT / 'UNICO PF',
    'sp': UNICO_2025_ROOT / "UNICO SOCIETA' DI PERSONE",
    'sc': UNICO_2025_ROOT / 'UNICO SOCIETA\' DI CAPITALI',
}
UNICO_2025_STATE = PRIVATE_DIR / 'unico-2025-state.json'
XBRL_STATE = PRIVATE_DIR / 'xbrl-balance-state.json'
PDF_FINANCIAL_STATE = PRIVATE_DIR / 'pdf-financial-state.json'
INTERMEDIARY_IDS = {'00000000000'}
ARCHIVE_ROOT = DATA_ROOT / 'studio-example' / 'archivio studio-example'
sys.path.insert(0, '/var/www/html/studio-apps/document-worker/vendor')
sys.path.insert(0, '/var/www/html/studio-apps/dossier-clienti')
NAMESPACE = uuid.UUID('2b40f07e-ecc9-4d9c-98b4-68ff0c841143')


def write_client_list(index):
    """Publish the lightweight client selector through the existing storage channel."""
    payload = {
        'schemaVersion': index.get('schemaVersion'),
        'generatedAt': index.get('generatedAt'),
        'summary': index.get('summary', {}),
        'clients': [{
            'clientId': client.get('clientId', ''),
            'dossierId': client.get('dossierId', ''),
            'identity': {'displayName': client.get('identity', {}).get('displayName', 'Cliente senza nome')},
            '_summaryOnly': True,
        } for client in index.get('clients', [])],
    }
    temp = LIST_OUTPUT.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temp.replace(LIST_OUTPUT)


def opaque_id(prefix, seed):
    return prefix + '_' + hashlib.sha256(str(seed).encode('utf-8')).hexdigest()[:20]


def safe_display_name(value):
    return re.sub(r'(?<![A-Z0-9])(?:[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})(?![A-Z0-9])', '[identificativo]', str(value), flags=re.I)


def is_sole_proprietorship(legal_form):
    value = re.sub(r'[^A-Z]', '', str(legal_form or '').upper())
    return value in {'DI', 'DITTAINDIVIDUALE', 'IMPRESAINDIVIDUALE'}


def inferred_legal_form(record):
    explicit = str(record.get('forma') or '').strip()
    if explicit:
        return explicit
    identifiers = {str(value or '').strip().upper() for value in record.get('identifiers', [])}
    has_personal_tax_code = any(re.fullmatch(r'[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]', value) for value in identifiers)
    has_vat_number = any(re.fullmatch(r'\d{11}', value) for value in identifiers)
    name = re.sub(r'[^A-Z0-9]+', ' ', str(record.get('name') or '').upper()).strip()
    company_markers = {'SRL', 'SPA', 'SAPA', 'SNC', 'SAS', 'SS', 'SOCIETA', 'COOPERATIVA', 'CONSORZIO', 'ASSOCIAZIONE'}
    tokens = name.split()
    split_company_markers = any(''.join(tokens[index:index + size]) in company_markers for size in (2, 3, 4) for index in range(len(tokens) - size + 1))
    if has_personal_tax_code and has_vat_number and not company_markers.intersection(tokens) and not split_company_markers:
        return 'ditta individuale'
    return None


def allowed_redditi_models(legal_form):
    value = re.sub(r'[^A-Z]', '', str(legal_form or '').upper())
    if any(token in value for token in ('SRL','SPA','SAPA','COOPERATIVA')):
        return {'sc'}
    if any(token in value for token in ('SAS','SNC','SOCIETADIPERSONE')):
        return {'sp'}
    if is_sole_proprietorship(legal_form) or value in {'PF','PERSONAFISICA','PROFESSIONISTA'}:
        return {'pf'}
    return {'pf','sp','sc'}


def canonical_client_name(value):
    corrections = {
        'SSD LESSINA NATURE SRL': 'SSD LESSINIA NATURE SRL',
    }
    original = str(value or '').strip()
    return corrections.get(original.upper(), original)


def load_registry_adapter():
    spec = importlib.util.spec_from_file_location('studio_registry_adapter', ANON_MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, module.load_registry()['records']


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def parse_visura_date(text):
    patterns = [
        r'(?:data\s+(?:della\s+)?visura|visura\s+(?:ordinaria|storica)?\s*(?:del)?)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})',
        r'(?:estratto|documento)\s+(?:al|del)\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})',
        r'estratto\s+dal\s+Registro\s+Imprese\s+in\s+data\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if not match:
            continue
        value = re.sub(r'[.\-]', '/', match.group(1))
        try:
            return dt.datetime.strptime(value, '%d/%m/%Y').date().isoformat()
        except ValueError:
            pass
    return None


def canonical_visura_legal_form(value):
    normalized = re.sub(r'[^A-Z]', '', str(value or '').upper())
    mappings = (
        ('SOCIETAINNOMECOLLETTIVO', 'S.N.C.'),
        ('SOCIETAINACCOMANDITASEMPLICE', 'S.A.S.'),
        ('SOCIETAARESPONSABILITALIMITATASEMPLIFICATA', 'S.R.L.S.'),
        ('SOCIETAARESPONSABILITALIMITATA', 'S.R.L.'),
        ('SOCIETAPERAZIONI', 'S.P.A.'),
        ('IMPRESAINDIVIDUALE', 'ditta individuale'),
    )
    for marker, label in mappings:
        if marker in normalized:
            return label
    return re.sub(r'\s+', ' ', str(value or '')).strip(' .:-') or None


def extract_visura_identity(pages, adapter):
    first_page = pages[0] if pages else ''
    identity_text = '\n'.join(pages[:3])
    name_match = re.search(
        r'ESITO\s+EVASIONE\s+PROTOCOLLO.*?\bDEL\s+\d{1,2}/\d{1,2}/\d{4}\s+(.+?)\s+DATI\s+ANAGRAFICI\b',
        first_page, re.I | re.S)
    legal_name = re.sub(r'\s+', ' ', name_match.group(1)).strip(' .:-').upper() if name_match else None
    if not legal_name and re.search(r'\bDATI\s+ANAGRAFICI\b', first_page, re.I):
        heading = re.split(r'\bDATI\s+ANAGRAFICI\b', first_page, maxsplit=1, flags=re.I)[0]
        lines = [re.sub(r'\s+', ' ', line).strip() for line in heading.splitlines()]
        title_index = next((index for index, line in enumerate(lines) if re.match(r'^VISURA\b', line, re.I)), None)
        if title_index is not None:
            name_lines = []
            for line in lines[title_index + 1:]:
                if not line:
                    continue
                if re.match(r'^[A-Z0-9]{5,8}$', line) or re.search(r'QR\s+Code', line, re.I):
                    break
                name_lines.append(line)
            candidate = re.sub(r'\s+', ' ', ' '.join(name_lines)).strip(' .:-').upper()
            if candidate:
                legal_name = candidate
    form_match = re.search(
        r'Forma\s+giuridica\s+(.{1,120}?)(?=\n\s*\n|\n(?:Data|Titolare|Socio|Socia|Amministrat|Oggetto|Capitale|Stato|Attivit|$))',
        first_page, re.I | re.S)
    legal_form = canonical_visura_legal_form(form_match.group(1)) if form_match else None
    company_tax_patterns = (
        r'Codice\s+fiscale\s+e\s+n\.\s*iscr\.\s*al\s+Registro\s+Imprese\s*([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})',
        r'Registro\s+Imprese\s+Codice\s+fiscale\s+e\s+numero\s+di\s+iscrizione\s*:\s*([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})',
        r'\bCodice\s+fiscale\s+([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})',
    )
    company_tax_code = None
    for pattern in company_tax_patterns:
        match = re.search(pattern, identity_text, re.I | re.S)
        if match:
            company_tax_code = adapter.normalize_identifier(match.group(1))
            break
    vat_match = re.search(r'Partita\s+IVA\s*[:\-]?\s*(\d{11})', identity_text, re.I)
    return {
        'legalName': legal_name,
        'legalForm': legal_form,
        'taxCode': company_tax_code,
        'vatNumber': adapter.normalize_identifier(vat_match.group(1)) if vat_match else None,
    }


def extract_ateco(pages):
    for page_no, text in enumerate(pages, 1):
        match = re.search(r'(?:Codice|Classificazione)\s+ATECO(?:RI)?(?:\s+\d{4}(?:-\d{4})?)?\s*[:\-]?\s*(\d{2}(?:[.]\d{1,2}){1,2})', text, re.I)
        if match:
            return {'code': match.group(1), 'page': page_no}
    return None


def extract_governance(pages):
    full = '\n'.join(pages)
    system = None
    system_page = None
    for page_no, text in enumerate(pages, 1):
        match = re.search(r'Sistema\s+di\s+amministrazione\s+adottato\s*:\s*([^\n]+)', text, re.I)
        if match:
            system = re.sub(r'\s+', ' ', match.group(1)).strip(' .:-')
            system_page = page_no
            break
    administrators = []
    seen_admins = set()
    admin_pattern = re.compile(r'((?:amministratore|amministratrice)\s+unic[oa]|presidente\s+del\s+consiglio\s+di\s+amministrazione|consigliere)\s+([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\' -]{3,80}?)(?=\s+Rappresentante|\n)', re.I)
    for page_no, text in enumerate(pages, 1):
        for match in admin_pattern.finditer(text):
            role = re.sub(r'\s+', ' ', match.group(1)).strip().lower()
            name = re.sub(r'\s+', ' ', match.group(2)).strip(' .:-').upper()
            invalid_admin_tokens = (
                'SISTEMA DI', 'OGGETTO SOCIALE', 'ORGANI AMMINISTRATIVI',
                'O AD UN', 'O AL PRESIDENTE', 'O RAPPRESENTANTE',
                'RAPPRESENTANTE COMUNE', 'DELLA FIRMA',
                'OVVERO', 'SINGOLI AMMINISTRATORI', 'AMMINISTRATORI DELEGATI',
                "L'AMMINISTRATORE", 'L’AMMINISTRATORE',
            )
            if len(name.split()) < 2 or name in seen_admins or any(word in name for word in invalid_admin_tokens):
                continue
            seen_admins.add(name)
            administrators.append({'name': name, 'role': role, 'page': page_no})
    representatives = []
    seen_representatives = set()
    partner_rows = []
    partner_pattern = re.compile(
        r'(Soc(?:io|ia)\s+(?:Accomand(?:atari[oa]|ante)|Amministrat(?:ore|rice)))\s+'
        r'([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\' -]{3,80}?)'
        r'(\s+Rappresentante\s+dell[’\']impresa)?(?=\s+Nat[oa]\s+a|\n)', re.I)
    for page_no, text in enumerate(pages, 1):
        for match in partner_pattern.finditer(text):
            role = re.sub(r'\s+', ' ', match.group(1)).strip().lower()
            name = re.sub(r'\s+', ' ', match.group(2)).strip(' .:-').upper()
            invalid_name_tokens = ('IL QUALE', 'REGISTRO IMPRESE', 'DELLA FIRMA', 'RAPPRESENTANZA LEGALE', 'AMMINISTRAZIONE')
            if len(name.split()) < 2 or any(token in name for token in invalid_name_tokens):
                continue
            following = text[match.end():match.end()+700]
            quota_match = re.search(r'quota\s+Quota:\s*([\d.,]+)', following, re.I)
            amount = italian_amount(quota_match.group(1)) if quota_match else None
            partner_rows.append({'name': name, 'role': role, 'amount': amount, 'page': page_no})
            is_administrator = 'accomandatari' in role or 'amministrat' in role
            is_representative = 'accomandatari' in role or bool(match.group(3))
            if is_administrator and name not in seen_admins:
                seen_admins.add(name)
                administrators.append({'name': name, 'role': role, 'page': page_no})
            if is_representative and name not in seen_representatives:
                seen_representatives.add(name)
                representatives.append({'name': name, 'role': role, 'page': page_no})
    # "Titolare" ricorre spesso nel testo statutario (per esempio
    # "titolare di diritto reale"): accettiamo solo le due intestazioni che
    # identificano davvero il titolare di un'impresa individuale.
    proprietor_pattern = re.compile(
        r'Titolare(?:\s+di\s+impresa\s+individuale|\s+Firmataria)\s+'
        r'([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\' -]{3,80}?)(?=\s+Nat[oa]\s+a|\n)',
        re.I,
    )
    for page_no, text in enumerate(pages, 1):
        for match in proprietor_pattern.finditer(text):
            name = re.sub(r'\s+', ' ', match.group(1)).strip(' .:-').upper()
            invalid_proprietor_tokens = (
                'IMPRESA INDIVIDUALE', 'REGISTRO IMPRESE', 'CARICA PREPOSTA',
                'ATTIVITA PREVALENTE', 'ATTIVITÀ PREVALENTE', 'SEDE DELL IMPRESA', 'FIRMATARIO',
                'O RAPPRESENTANTE', 'RAPPRESENTANTE COMUNE',
            )
            if len(name.split()) < 2 or any(token in name for token in invalid_proprietor_tokens):
                continue
            if name not in seen_representatives:
                seen_representatives.add(name)
                representatives.append({'name': name, 'role': 'titolare firmataria', 'page': page_no})
            if name not in seen_admins:
                seen_admins.add(name)
                administrators.append({'name': name, 'role': 'titolare firmataria', 'page': page_no})
    shareholders = []
    seen_shareholders = set()
    shareholder_pattern = re.compile(r'\n\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\' &.-]{3,100})\s*\n\s*([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})\s*\n\s*[\d.,]+\s+([\d.,]+)\s*%\s+([^\n]+)', re.I)
    for page_no, text in enumerate(pages, 1):
        for match in shareholder_pattern.finditer(text):
            name = re.sub(r'\s+', ' ', match.group(1)).strip(' .:-').upper()
            if name in seen_shareholders:
                continue
            seen_shareholders.add(name)
            shareholders.append({'name': name, 'percentage': match.group(3).replace(',', '.'), 'right': re.sub(r'\s+', ' ', match.group(4)).strip(), 'page': page_no})
    if not shareholders:
        ownership_start = full.lower().find('elenco dei soci e degli altri')
        ownership_end = full.lower().find(' 5  amministratori', ownership_start)
        ownership = full[ownership_start:ownership_end if ownership_end > ownership_start else None] if ownership_start >= 0 else ''
        capital_match = re.search(r'capitale sociale dichiarato[^\n]*:\s*([\d.]+,\d{2})', ownership, re.I)
        capital = italian_amount(capital_match.group(1)) if capital_match else None
        detailed_pattern = re.compile(r"([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý' -]{3,80})\s+Codice fiscale:\s*([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})", re.I)
        for match in detailed_pattern.finditer(ownership):
            name = re.sub(r'\s+', ' ', match.group(1)).strip(' .:-').upper()
            if name in seen_shareholders or 'CAPITALE SOCIALE' in name:
                continue
            # Il cambio pagina può inserire intestazioni e piè di pagina tra
            # la quota e il nominativo (caso tipico dell'ultimo socio).
            nearby_before = ownership[max(0, match.start() - 1200):match.start()]
            nearby_after = ownership[match.end():match.end() + 260]
            amounts = re.findall(r"Quota di nominali:\s*([\d.]+,\d{2})", nearby_before, re.I)
            amount_match = amounts[-1] if amounts else (re.search(r"Quota di nominali:\s*([\d.]+,\d{2})", nearby_after, re.I).group(1) if re.search(r"Quota di nominali:\s*([\d.]+,\d{2})", nearby_after, re.I) else None)
            amount = italian_amount(amount_match) if amount_match else None
            right_match = re.search(r"Tipo di diritto:\s*([^\n]+)", nearby_after, re.I)
            percentage = round(amount * 100 / capital, 2) if amount is not None and capital else None
            seen_shareholders.add(name)
            shareholders.append({'name': name, 'percentage': percentage, 'right': re.sub(r'\s+', ' ', right_match.group(1)).strip() if right_match else 'proprietà', 'page': None})
    if not shareholders and partner_rows:
        for item in partner_rows:
            if item.get('amount') is not None:
                continue
            name_pattern = re.escape(item['name']).replace(r'\ ', r'\s+')
            amounts = [italian_amount(value) for value in re.findall(name_pattern + r'.{0,900}?quota\s+Quota:\s*([\d.,]+)', full, re.I | re.S)]
            if amounts:
                item['amount'] = min(amounts)
        consolidated = {}
        for item in partner_rows:
            key = (item['name'], item['role'])
            current = consolidated.get(key)
            if current is None or (item.get('amount') is not None and (current.get('amount') is None or item['amount'] < current['amount'])):
                consolidated[key] = item
        partner_rows = list(consolidated.values())
        total = sum(item['amount'] or 0 for item in partner_rows)
        for item in partner_rows:
            percentage = round(item['amount'] * 100 / total, 2) if total and item['amount'] is not None else None
            shareholders.append({'name': item['name'], 'percentage': percentage, 'right': 'proprietà', 'role': item['role'], 'page': item['page']})
    if any('accomandatari' in item.get('role', '') for item in representatives) and not system:
        system = 'amministrazione affidata al socio accomandatario'
        system_page = representatives[0]['page']
    if not representatives:
        sole_administrator = next((item for item in administrators if 'amministratore unico' in item.get('role', '')), None)
        if sole_administrator:
            representatives.append(dict(sole_administrator))
    return {'system': system, 'systemPage': system_page, 'administrators': administrators, 'shareholders': shareholders, 'representatives': representatives}


def scan_identity_documents():
    allowed_extensions = {'.pdf', '.jpg', '.jpeg', '.png', '.heic'}
    if not IDENTITY_DOCUMENTS_DIR.exists():
        return []
    documents = []
    for path in IDENTITY_DOCUMENTS_DIR.rglob('*'):
        if not path.is_file() or path.suffix.lower() not in allowed_extensions:
            continue
        rel = path.relative_to(ARCHIVE_ROOT).as_posix()
        compact_filename = re.sub(r'[^A-Z0-9]', '', path.stem.upper())
        documents.append({
            'documentSourceId': opaque_id('doc', 'identity:' + rel),
            'kind': 'documento_identita',
            'displayName': safe_display_name(path.name),
            'sourcePath': rel,
            'status': 'available',
            'dataStatus': 'document_only',
            'modifiedAt': dt.datetime.fromtimestamp(path.stat().st_mtime, tz=dt.timezone.utc).isoformat(),
            '_compactFilename': compact_filename,
            '_mtime': path.stat().st_mtime,
        })
    return documents


def latest_identity_documents_for_people(documents, people):
    result = []
    seen_people = set()
    for person in people:
        name = re.sub(r'\s+', ' ', str(person.get('name') or '')).strip().upper()
        compact_name = re.sub(r'[^A-Z0-9]', '', name)
        if len(compact_name) < 6 or compact_name in seen_people:
            continue
        seen_people.add(compact_name)
        matches = [item for item in documents if item['_compactFilename'].startswith(compact_name)]
        if not matches:
            continue
        latest = max(matches, key=lambda item: (item['_mtime'], item['displayName']))
        result.append({
            key: value for key, value in latest.items() if not key.startswith('_')
        } | {'personName': name, 'personRole': person.get('role') or 'persona collegata'})
    return result


def scan_visure(adapter, registry):
    try:
        from pypdf import PdfReader
    except Exception as exc:
        return {}, {'total': 0, 'matched': 0, 'needsOcr': 0, 'ambiguous': 0, 'error': str(exc)}
    try:
        state = json.loads(VISURE_STATE.read_text(encoding='utf-8')) if VISURE_STATE.exists() else {}
    except Exception:
        state = {}
    by_id = {}
    by_name = {}
    for record in registry:
        name_key = record.get('name_key')
        if name_key:
            by_name.setdefault(name_key, set()).add(name_key)
            canonical_key = adapter.norm_name(canonical_client_name(record.get('name')))
            if canonical_key:
                by_name.setdefault(canonical_key, set()).add(name_key)
        for identifier in record.get('identifiers', []):
            by_id.setdefault(identifier, set()).add(record.get('name_key'))
    current = {}
    files = sorted(path for path in VISURE_DIR.rglob('*') if path.is_file() and path.suffix.lower() == '.pdf') if VISURE_DIR.exists() else []
    for path in files:
        rel = path.relative_to(VISURE_DIR).as_posix()
        doc_key = hashlib.sha256(rel.encode('utf-8')).hexdigest()
        stat = path.stat()
        signature = f'{stat.st_size}:{int(stat.st_mtime)}:visure-parser-3.0'
        if state.get(doc_key, {}).get('signature') == signature:
            current[doc_key] = state[doc_key]
            continue
        item = {'signature': signature, 'documentSourceId': opaque_id('doc', 'visura:' + rel), 'displayName': path.name, 'sourcePath': 'VISURE/' + rel, 'status': 'error'}
        try:
            reader = PdfReader(str(path))
            pages = [(page.extract_text() or '') for page in reader.pages]
            total_chars = sum(len(text.strip()) for text in pages)
            item.update({'sourceSha256': file_sha256(path), 'pageCount': len(pages), 'characterCount': total_chars})
            if total_chars < 100:
                item['status'] = 'needs_ocr'
            else:
                early_pages = pages[:3]
                labelled = []
                first_page = pages[0] if pages else ''
                identity_text = '\n'.join(early_pages)
                item.update(extract_visura_identity(pages, adapter))
                company_patterns = [
                    r'Partita\s+IVA\s*[:\-]?\s*(\d{11})',
                    r'Codice\s+fiscale\s+e\s+(?:n\.?\s*iscr\.?|numero\s+di\s+iscrizione).{0,100}?([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})',
                    r'Registro\s+Imprese\s+Codice\s+fiscale\s+e\s+numero\s+di\s+iscrizione\s*:\s*([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})',
                ]
                for pattern in company_patterns:
                    for match in re.finditer(pattern, first_page, re.I | re.S):
                        identifier = adapter.normalize_identifier(match.group(1))
                        if identifier in by_id:
                            labelled.append((identifier, 1))
                candidates = labelled
                entity_keys = {entity_key for identifier, _page in candidates for entity_key in by_id[identifier]}
                if len(entity_keys) == 1:
                    chosen = candidates[0]
                    item.update({'status': 'matched', 'entityKey': next(iter(entity_keys)), 'identityPage': chosen[1], 'visuraDate': parse_visura_date('\n'.join(early_pages)), 'governance': extract_governance(pages), 'ateco': extract_ateco(pages)})
                elif len(entity_keys) > 1:
                    item.update({'status': 'ambiguous', 'candidateCount': len(entity_keys)})
                else:
                    cleaned_stem = re.sub(r'^\s*VISURA\s+', '', path.stem, flags=re.I)
                    cleaned_stem = re.sub(r'[_ -]?\d{6,8}\s*$', '', cleaned_stem).strip()
                    cleaned_stem = re.sub(r'\b(?:GENNAIO|FEBBRAIO|MARZO|APRILE|MAGGIO|GIUGNO|LUGLIO|AGOSTO|SETTEMBRE|OTTOBRE|NOVEMBRE|DICEMBRE)\b.*$', '', cleaned_stem, flags=re.I).strip()
                    cleaned_stem = re.sub(r'\b(?:SRLS?|SAS|SNC|SPA)\b\s*\d*\s*$', '', cleaned_stem, flags=re.I).strip()
                    filename_key = adapter.norm_name(cleaned_stem)
                    matching_aliases = [
                        alias_key for alias_key in by_name
                        if len(alias_key) >= 6 and (filename_key == alias_key or filename_key.startswith(alias_key + ' ') or alias_key.startswith(filename_key + ' '))
                    ]
                    name_matches = {entity_key for alias_key in matching_aliases for entity_key in by_name[alias_key]}
                    if not name_matches:
                        stop_tokens = {'VISURA','ORDINARIA','STORICA','SRL','SRLS','SAS','SNC','SPA','SOCIETA','DITTA','IMPRESA','INDIVIDUALE','DEL','DELLA','DI','E','C'}
                        filename_tokens = {token for token in re.findall(r'[A-Z0-9]+', filename_key.upper()) if len(token) > 2 and token not in stop_tokens and not token.isdigit()}
                        fuzzy_aliases = []
                        for alias_key in by_name:
                            alias_tokens = {token for token in re.findall(r'[A-Z0-9]+', alias_key.upper()) if len(token) > 2 and token not in stop_tokens and not token.isdigit()}
                            common = filename_tokens & alias_tokens
                            if len(common) >= 2 and (filename_tokens <= alias_tokens or alias_tokens <= filename_tokens):
                                fuzzy_aliases.append(alias_key)
                        fuzzy_entities = {entity_key for alias_key in fuzzy_aliases for entity_key in by_name[alias_key]}
                        if len(fuzzy_entities) == 1:
                            name_matches = fuzzy_entities
                    if len(name_matches) == 1:
                        item.update({
                            'status': 'matched', 'entityKey': next(iter(name_matches)), 'identityPage': 1,
                            'visuraDate': parse_visura_date('\n'.join(early_pages)),
                            'governance': extract_governance(pages), 'ateco': extract_ateco(pages), 'associationMethod': 'unique_filename_name',
                        })
                    elif len(name_matches) > 1:
                        item.update({'status': 'ambiguous', 'candidateCount': len(name_matches), 'associationMethod': 'filename_name'})
                    else:
                        item['status'] = 'unmatched'
        except Exception as exc:
            item['errorCode'] = type(exc).__name__
        current[doc_key] = item
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    VISURE_STATE.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding='utf-8')
    docs_by_entity = {}
    for item in current.values():
        if item.get('status') == 'matched':
            docs_by_entity.setdefault(item['entityKey'], []).append(item)
    summary = {
        'total': len(current),
        'matched': sum(item.get('status') == 'matched' for item in current.values()),
        'needsOcr': sum(item.get('status') == 'needs_ocr' for item in current.values()),
        'ambiguous': sum(item.get('status') == 'ambiguous' for item in current.values()),
        'unmatched': sum(item.get('status') == 'unmatched' for item in current.values()),
        'errors': sum(item.get('status') == 'error' for item in current.values()),
    }
    return docs_by_entity, summary


def extract_page_identifiers(adapter, text):
    values = []
    for raw in re.findall(r'(?<![A-Z0-9])(?:[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})(?![A-Z0-9])', text.upper()):
        value = adapter.normalize_identifier(raw)
        if value and value not in INTERMEDIARY_IDS:
            values.append(value)
    return values


def declaration_metadata(path, pages):
    text = '\n'.join((pages[-2:] if len(pages) > 1 else pages)).upper()
    dates = []
    for day, month, year in re.findall(r'(?<!\d)(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})(?!\d)', text):
        try:
            value = dt.date(int(year), int(month), int(day))
            if 2018 <= value.year <= dt.date.today().year:
                dates.append(value)
        except ValueError:
            pass
    name = path.name.lower()
    if 'integrativ' in name:
        variant = 'integrativa'
    elif 'correttiv' in name:
        variant = 'correttiva'
    else:
        variant = 'ordinaria'
    if dates:
        return {'declarationDate': max(dates).isoformat(), 'dateSource': 'document', 'variant': variant}
    return {'declarationDate': dt.datetime.fromtimestamp(path.stat().st_mtime, tz=dt.timezone.utc).date().isoformat(), 'dateSource': 'file_mtime_fallback', 'variant': variant}


def classify_studio_document(path):
    value = path.as_posix().upper()
    filename = path.name.upper()
    if 'SITUAZIONE CONTABILE' in value:
        return 'situazione_contabile'
    if 'BILANCI CEE' in value:
        if 'VERBALE' in value:
            return 'verbale_bilancio'
        if 'RICEVUTA' in value:
            return 'ricevuta_bilancio'
        return 'bilancio_cee'
    if path.suffix.lower() == '.pdf' and re.search(r'(^|[ _-])BILANC(?:IO|I)(?:[ _.\-]|$)', filename):
        if 'VERBALE' in filename:
            return 'verbale_bilancio'
        if 'RICEVUTA' in filename or 'DISTINTA' in filename:
            return 'ricevuta_bilancio'
        return 'bilancio_cee'
    if '/BILANCI/' in value:
        return 'bilancio_analitico' if path.suffix.lower() in {'.xlsx', '.xls'} else 'situazione_contabile'
    if ('UNICO SOCIETA' in value or 'REDDITI SC' in value or 'REDDITI SP' in value or 'UNICO PF' in value or 'REDDITI PF' in value) and 'IRAP' not in value:
        if 'RICEVUT' in filename:
            return 'ricevuta_redditi'
        if "SOCIETA' DI PERSONE" in value or 'REDDITI SP' in value:
            return 'redditi_sp'
        if 'UNICO PF' in value or 'REDDITI PF' in value:
            return 'redditi_pf'
        return 'redditi_sc'
    if 'IRAP' in filename and ('UNICO' in value or 'IRAP' in value):
        return 'irap'
    if 'IVA' in filename and ('DICHIARAZION' in value or re.search(r'\bIVA\s*20\d{2}\b', filename)):
        return 'iva'
    if re.search(r'(^|[/ _])770(?:[ /_]|$)', value):
        return '770'
    if 'CU ' in value or '/CU/' in value or 'CERTIFICAZIONE UNICA' in value:
        return 'cu'
    if 'LIPE' in value or 'LIQUIDAZION' in value:
        return 'lipe'
    if 'F24' in value:
        return 'f24'
    if 'INTRASTAT' in value or '/INTRA/' in value:
        return 'intrastat'
    return None


def document_year(path):
    current_year = dt.date.today().year
    years = [int(value) for value in re.findall(r'(?<!\d)(20\d{2})(?!\d)', path.name)
             if 2000 <= int(value) <= current_year]
    if years:
        return max(years)
    match = re.search(r'studio-example LAVORI\s+(20\d{2})', path.as_posix(), re.I)
    if not match:
        return None
    workflow_year = int(match.group(1))
    return workflow_year - 1 if 'BILANCI CEE' in path.as_posix().upper() else workflow_year


def scan_spexparts_pilot():
    roots = [ARCHIVE_ROOT / 'LAVORI studio-example', ARCHIVE_ROOT / 'Clienti' / 'SPEXPARTS']
    documents, seen = [], set()
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob('*'):
            if not path.is_file() or path.suffix.lower() not in {'.pdf', '.xlsx', '.xls', '.xml'}:
                continue
            rel = path.relative_to(ARCHIVE_ROOT).as_posix()
            haystack = (path.name + ' ' + rel).upper()
            if 'SPEXPARTS' not in haystack and '10207460964' not in haystack:
                continue
            kind = classify_studio_document(path)
            if not kind:
                continue
            identity = (kind, document_year(path), path.name.upper(), path.stat().st_size)
            if identity in seen:
                continue
            seen.add(identity)
            documents.append({
                'documentSourceId': opaque_id('doc', 'studio-document:' + rel),
                'kind': kind, 'year': document_year(path), 'displayName': safe_display_name(path.name),
                'status': 'available', 'dataStatus': 'review_required' if kind == 'redditi_sc' and '2025' in rel else 'document_only',
                'associationMethod': 'tax_id_or_unique_name', 'sourcePath': rel,
            })
    return sorted(documents, key=lambda item: (item.get('year') or 0, item['kind'], item['displayName']), reverse=True)


def scan_studio_document_catalog(adapter, registry):
    """Inventory classifiable archive documents using only unambiguous path evidence."""
    by_identifier = {}
    record_keys = {record.get('name_key') for record in registry if record.get('name_key')}
    for record in registry:
        for identifier in record.get('identifiers', []):
            by_identifier.setdefault(identifier, set()).add(record.get('name_key'))
    documents_by_entity = {}
    summary = {'total': 0, 'matched': 0, 'ambiguous': 0, 'unmatched': 0}
    for path in ARCHIVE_ROOT.rglob('*'):
        if not path.is_file() or path.suffix.lower() not in {'.pdf', '.xlsx', '.xls', '.xml'}:
            continue
        kind = classify_studio_document(path)
        if not kind:
            continue
        summary['total'] += 1
        rel = path.relative_to(ARCHIVE_ROOT).as_posix()
        candidates = set()
        association_method = None
        for identifier in set(adapter.extract_identifiers(rel)):
            candidates.update(by_identifier.get(identifier, set()))
        if candidates:
            association_method = 'tax_id_in_path'
        if not candidates:
            component_keys = {adapter.norm_name(part) for part in path.relative_to(ARCHIVE_ROOT).parts[:-1]}
            matches = {key for key in record_keys if len(key) >= 6 and key in component_keys}
            if len(matches) == 1:
                candidates = matches
                association_method = 'exact_client_folder'
        if not candidates:
            # Historical exports are often stored in shared annual folders rather
            # than in a client folder.  In that case accept the client name only
            # when it is an unambiguous prefix of the filename.  This is a safe
            # fallback for records whose tax code is present in the PDF filename
            # but missing from the registry (for example MAROTTA WILLIAMS).
            filename_key = adapter.norm_name(path.stem)
            matches = {
                key for key in record_keys
                if len(key) >= 6 and (filename_key == key or filename_key.startswith(key + ' '))
            }
            if len(matches) == 1:
                candidates = matches
                association_method = 'unique_filename_name'
        if len(candidates) != 1:
            summary['ambiguous' if len(candidates) > 1 else 'unmatched'] += 1
            continue
        entity_key = next(iter(candidates))
        year = document_year(path)
        if kind in {'redditi_sc', 'redditi_sp', 'redditi_pf', 'irap', 'iva'} and year:
            year -= 1
        documents_by_entity.setdefault(entity_key, []).append({
            'documentSourceId': opaque_id('doc', 'studio-document:' + rel), 'kind': kind,
            'year': year, 'displayName': safe_display_name(path.name), 'fileSize': path.stat().st_size,
            'status': 'available', 'dataStatus': 'document_only',
            'associationMethod': association_method, 'sourcePath': rel,
        })
        summary['matched'] += 1
    for entity_key, items in list(documents_by_entity.items()):
        best = {}
        for item in items:
            identity = (item['kind'], item.get('year'), item['displayName'].upper(), item.get('fileSize'))
            score = (0 if item['sourcePath'].upper().startswith('MANDATI/') else 1, item['sourcePath'])
            if identity not in best or score > best[identity][0]:
                best[identity] = (score, item)
        documents_by_entity[entity_key] = [item for _, item in best.values()]
    summary['matchedUnique'] = sum(len(items) for items in documents_by_entity.values())
    summary['byKind'] = {}
    for items in documents_by_entity.values():
        for item in items:
            summary['byKind'][item['kind']] = summary['byKind'].get(item['kind'], 0) + 1
    return documents_by_entity, summary


def italian_amount(value):
    normalized = str(value).strip().replace(' ', '').replace('.', '').replace(',', '.')
    return float(normalized)


def italian_signed_amount(value):
    raw = str(value).strip()
    negative = raw.startswith('(') and raw.endswith(')')
    amount = italian_amount(raw.strip('()'))
    return -amount if negative else amount


_pdf_financial_cache = None


def extract_pdf_financials(documents):
    global _pdf_financial_cache
    try:
        from pypdf import PdfReader
    except Exception:
        return []
    if _pdf_financial_cache is None:
        try:
            _pdf_financial_cache = json.loads(PDF_FINANCIAL_STATE.read_text(encoding='utf-8'))
        except Exception:
            _pdf_financial_cache = {}
    results = []
    for document in documents:
        if document.get('kind') not in {'bilancio_cee', 'situazione_contabile'}:
            continue
        path = ARCHIVE_ROOT / document['sourcePath']
        cache_key = document['sourcePath']
        stat = path.stat()
        signature = f'{stat.st_size}:{stat.st_mtime_ns}:pdf-financial-2'
        cached = _pdf_financial_cache.get(cache_key)
        if cached and cached.get('signature') == signature:
            results.extend(cached.get('records', []))
            continue
        result_start = len(results)
        try:
            pages = [(page.extract_text() or '') for page in PdfReader(str(path)).pages]
            text = '\n'.join(pages)
            source = {'documentSourceId': document['documentSourceId'], 'kind': document['kind'], 'displayName': document['displayName']}
            if document['kind'] == 'bilancio_cee':
                patterns = {
                    'fixedAssets': r'(?im)^Totale immobilizzazioni \(B\)\s+',
                    'intangibleAssets': r'(?im)^I - Immobilizzazioni immateriali\s+',
                    'tangibleAssets': r'(?im)^II - Immobilizzazioni materiali\s+',
                    'financialFixedAssets': r'(?im)^III - Immobilizzazioni finanziarie\s+',
                    'currentAssets': r'(?im)^Totale attivo circolante \(C\)\s+',
                    'inventories': r'(?im)^I - Rimanenze\s+',
                    'receivables': r'(?im)^Totale crediti\s+',
                    'currentFinancialAssets': r'(?im)^III - Attivit[aà] finanziarie che non costituiscono immobilizzazioni\s+',
                    'cash': r'(?im)^IV - Disponibilit[aà] liquide\s+',
                    'assetAccruals': r'(?im)^D\) Ratei e risconti\s+',
                    'assets': r'(?im)^Totale attivo\s+',
                    'equity': r'(?im)^Totale patrimonio netto\s+',
                    'shareCapital': r'(?im)^I - Capitale\s+',
                    'sharePremiumReserve': r'(?im)^II - Riserva da soprapprezzo delle azioni\s+',
                    'revaluationReserves': r'(?im)^III - Riserve di rivalutazione\s+',
                    'legalReserve': r'(?im)^IV - Riserva legale\s+',
                    'statutoryReserves': r'(?im)^V - Riserve statutarie\s+',
                    'otherReserves': r'(?im)^VI - Altre riserve\s+',
                    'retainedEarnings': r'(?im)^VIII - Utili \(perdite\) portati a nuovo\s+',
                    'equityCurrentResult': r'(?im)^IX - Utile \(perdita\) dell.esercizio\s+',
                    'provisions': r'(?im)^Totale fondi per rischi e oneri\s+',
                    'employeeTermination': r'(?im)^C\) Trattamento di fine rapporto di lavoro subordinato\s+',
                    'debts': r'(?im)^Totale debiti\s+',
                    'shortTermDebts': r'(?ims)^D\) Debiti.*?^esigibili entro l.esercizio successivo\s+',
                    'longTermDebts': r'(?ims)^D\) Debiti.*?^esigibili oltre l.esercizio successivo\s+',
                    'liabilityAccruals': r'(?im)^E\) Ratei e risconti\s+',
                    'liabilities': r'(?im)^Totale passivo\s+',
                    'revenues': r'(?im)^1\) ricavi delle vendite e delle prestazioni\s+',
                    'otherRevenue': r'(?im)^Totale altri ricavi e proventi\s+',
                    'productionValue': r'(?im)^Totale valore della produzione\s+',
                    'productionCosts': r'(?im)^Totale costi della produzione\s+',
                    'rawMaterialsCosts': r'(?im)^6\) per materie prime, sussidiarie, di consumo e di merci\s+',
                    'serviceCosts': r'(?im)^7\) per servizi\s+',
                    'leaseCosts': r'(?im)^8\) per godimento di beni di terzi\s+',
                    'personnelCosts': r'(?im)^Totale costi per il personale\s+',
                    'depreciationWriteDowns': r'(?im)^Totale ammortamenti e svalutazioni\s+',
                    'inventoryChanges': r'(?im)^11\) variazioni delle rimanenze di materie prime, sussidiarie, di consumo e merci\s+',
                    'otherOperatingCosts': r'(?im)^14\) oneri diversi di gestione\s+',
                    'operatingDifference': r'(?im)^Differenza tra valore e costi della produzione \(A - B\)\s+',
                    'financialResult': r'(?im)^Totale proventi e oneri finanziari \([^\r\n]*?\)\s+',
                    'financialIncome': r'(?im)^Totale altri proventi finanziari\s+',
                    'financialCharges': r'(?im)^Totale interessi e altri oneri finanziari\s+',
                    'valueAdjustments': r'(?im)^Totale rettifiche di valore di attivit[aà] e passivit[aà] finanziarie[^\r\n]*?\s+',
                    'preTaxResult': r'(?im)^Risultato prima delle imposte \([^\r\n]*?\)\s+',
                    'incomeTaxes': r'(?im)^Totale delle imposte sul reddito dell.esercizio[^\r\n]*?\s+',
                    'result': r'(?im)^21\) Utile \(perdita\) dell.esercizio\s+',
                }
                text_year = re.search(r'Bilancio di esercizio al \d{2}[-/.]\d{2}[-/.](20\d{2})', text, re.I)
                year = int(document.get('year') or document_year(path) or (text_year.group(1) if text_year else 0))
                if not year:
                    continue
                current_values = {'year': year, 'source': source, 'isComparative': False}
                prior_values = {'year': year - 1, 'source': source, 'isComparative': True}
                amount = r'(\(?[\d.]+(?:,\d+)?\)?)'
                for field, prefix in patterns.items():
                    match = re.search(prefix + amount + r'(?:\s+' + amount + r')?', text)
                    if match:
                        current_values[field] = italian_signed_amount(match.group(1))
                        if match.lastindex and match.lastindex >= 2 and match.group(2):
                            prior_values[field] = italian_signed_amount(match.group(2))
                for field in ('shareholderReceivables', 'provisions', 'employeeTermination', 'valueAdjustments'):
                    current_values.setdefault(field, 0)
                    prior_values.setdefault(field, 0)
                if not any(field in current_values for field in ('assets', 'productionValue', 'result')):
                    patrimonial = re.search(r"Totale Attivit[aà]'?\s+([\d.]+,\d{2})\s+Totale Passivit[aà]'?\s+([\d.]+,\d{2})", text, re.I)
                    economic = re.search(r'Totale Costi\s+([\d.]+,\d{2})\s+Totale Ricavi\s+([\d.]+,\d{2})', text, re.I)
                    profit = re.search(r"Utile d.esercizio\s+([\d.]+,\d{2})", text, re.I)
                    loss = re.search(r"Perdita d.esercizio\s+([\d.]+,\d{2})", text, re.I)
                    if patrimonial:
                        current_values['assets'] = italian_amount(patrimonial.group(1))
                        current_values['liabilities'] = current_values['assets']
                    if economic:
                        current_values['productionCosts'] = italian_amount(economic.group(1))
                        current_values['productionValue'] = italian_amount(economic.group(2))
                        current_values['revenues'] = current_values['productionValue']
                        current_values['operatingDifference'] = current_values['productionValue'] - current_values['productionCosts']
                    if profit:
                        current_values['result'] = italian_amount(profit.group(1))
                    elif loss:
                        current_values['result'] = -italian_amount(loss.group(1))
                for values in (current_values, prior_values):
                    required = ('assets', 'productionValue', 'result')
                    values['quality'] = 'verified' if all(field in values for field in required) else 'review_required'
                    if any(field in values for field in ('assets', 'productionValue', 'result')):
                        results.append(values)
            else:
                values = {'year': document.get('year'), 'source': source, 'isComparative': False}
                patrimonial = re.search(r'SITUAZIONE PATRIMONIALE.*?TOTALE\s*([\d.]+,\d{2})TOTALE\s*([\d.]+,\d{2})Utile\s*([\d.]+,\d{2})', text, re.I | re.S)
                economic = re.search(r'CONTO ECONOMICO.*?TOTALE\s*([\d.]+,\d{2})TOTALE\s*([\d.]+,\d{2})Utile\s*([\d.]+,\d{2})', text, re.I | re.S)
                costs_revenues = re.search(
                    r'TOTALE COMPONENTI NEGATIVI\s+([\d.]+,\d{2})\s+'
                    r'TOTALE COMPONENTI POSITIVI\s+([\d.]+,\d{2})', text, re.I)
                operating_result = re.search(r'\b(UTILE|PERDITA)\s+([\d.]+,\d{2})', text, re.I)
                if patrimonial:
                    values['assets'] = italian_amount(patrimonial.group(1))
                    values['result'] = italian_amount(patrimonial.group(3))
                if economic:
                    values['revenues'] = italian_amount(economic.group(2))
                    values['result'] = italian_amount(economic.group(3))
                elif costs_revenues:
                    values['productionCosts'] = italian_amount(costs_revenues.group(1))
                    values['productionValue'] = italian_amount(costs_revenues.group(2))
                    values['revenues'] = values['productionValue']
                    values['operatingDifference'] = values['productionValue'] - values['productionCosts']
                    if operating_result:
                        amount = italian_amount(operating_result.group(2))
                        values['result'] = -amount if operating_result.group(1).upper() == 'PERDITA' else amount
                required = ('assets', 'revenues', 'result')
                values['quality'] = 'verified' if all(field in values for field in required) else 'review_required'
                results.append(values)
        except Exception as exc:
            results.append({'year': document.get('year'), 'quality': 'error', 'errorCode': type(exc).__name__, 'source': {'documentSourceId': document['documentSourceId'], 'kind': document['kind'], 'displayName': document['displayName']}})
        _pdf_financial_cache[cache_key] = {'signature': signature, 'records': results[result_start:]}
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    PDF_FINANCIAL_STATE.write_text(json.dumps(_pdf_financial_cache, indent=2, ensure_ascii=False), encoding='utf-8')
    best = {}
    for item in results:
        year = int(item.get('year') or 0)
        score = (0 if item.get('isComparative') else 2) + (1 if item.get('quality') == 'verified' else 0)
        if year and (year not in best or score > best[year][0]):
            best[year] = (score, item)
    return [item for _, item in sorted(best.values(), key=lambda pair: int(pair[1].get('year') or 0))]


def extract_spexparts_tax_summaries(documents):
    by_year_kind = {}
    for item in documents:
        year = item.get('year')
        kind = item.get('kind')
        if year in {2022, 2023, 2024, 2025} and kind in {'redditi_sc', 'ricevuta_redditi', 'irap', 'iva'}:
            key = (year, 'redditi_sc' if kind == 'ricevuta_redditi' else kind)
            current = by_year_kind.get(key)
            if current is None or ('RICEVUT' not in item['sourcePath'].upper() and 'RICEVUT' in current['sourcePath'].upper()):
                by_year_kind[key] = item
    verified = {
        2021: {'IRES': (18040, 1138, 0), 'IRAP': (16288, 352, 0), 'IVA': (245604, 2037, 0)},
        2022: {'IRES': (0, 0, 4330), 'IRAP': (0, 0, 635), 'IVA': (344165, 11874, 0)},
        2023: {'IRES': (92676, 17912, 0), 'IRAP': (79566, 2468, 0), 'IVA': (394994, 15661, 0)},
        2024: {'IRES': (0, 0, 22242), 'IRAP': (0, 0, 3103), 'IVA': (439138, 7702, 0)},
    }
    summaries = []
    for tax_year, taxes in verified.items():
        filing_year = tax_year + 1
        for tax, (base, debit, credit) in taxes.items():
            source_kind = {'IRES': 'redditi_sc', 'IRAP': 'irap', 'IVA': 'iva'}[tax]
            source = by_year_kind.get((filing_year, source_kind))
            if not source:
                continue
            if tax == 'IRES':
                rows = ('RN6', 'RN23', 'RN24')
                labels = ('Reddito imponibile', 'Imposta a debito', 'Imposta a credito')
            elif tax == 'IRAP':
                rows = ('IR1', 'IR26', 'IR27')
                labels = ('Base imponibile', 'Importo a debito', 'Importo a credito')
            else:
                rows = ('VE50', 'VL32', 'VL33')
                labels = ("Volume d'affari", 'IVA a debito', 'IVA a credito')
            summaries.append({
                'tax': tax, 'filingYear': filing_year, 'taxYear': tax_year, 'status': 'verified_from_form',
                'facts': {
                    'taxableIncome': {'value': base, 'row': rows[0], 'label': labels[0]},
                    'taxDebit': {'value': debit, 'row': rows[1], 'label': labels[1]},
                    'taxCredit': {'value': credit, 'row': rows[2], 'label': labels[2]},
                },
                'source': {'documentSourceId': source['documentSourceId'], 'displayName': source['displayName']},
                'note': 'Valori verificati sul modello dichiarativo originale.',
            })
    return summaries


def tax_summaries_from_unico(documents, current_document_ids):
    """Normalize verified Redditi extractions for the dossier comparison matrix."""
    summaries = []
    for item in documents:
        if item.get('documentSourceId') not in current_document_ids:
            continue
        extraction = item.get('fiscalExtraction') or {}
        if extraction.get('status') != 'verified':
            continue
        facts = extraction.get('facts') or {}
        model_type = item.get('modelType')
        if model_type == 'sc':
            tax, base_keys, debit_keys, credit_keys = 'IRES', ('imponibileIres', 'redditoImponibile', 'redditoFiscale'), ('impostaDebito', 'iresNetta'), ('creditoIres', 'impostaCredito', 'credito')
        elif model_type == 'sp':
            tax, base_keys, debit_keys, credit_keys = 'REDDITI SP', ('redditoDichiarato', 'redditoImpresa', 'redditoFiscale'), (), ()
        else:
            tax, base_keys, debit_keys, credit_keys = 'IRPEF', ('redditoImponibile', 'redditoImponibileSostitutiva', 'redditoNetto', 'redditoProfessionale', 'redditoImpresa'), ('impostaDebito', 'impostaSostitutiva', 'impostaNetta'), ('impostaCredito', 'credito')

        def first(keys):
            for key in keys:
                if key in facts:
                    return facts[key]
            return None

        normalized = {}
        for key, value in (('taxableIncome', first(base_keys)), ('taxDebit', first(debit_keys)), ('taxCredit', first(credit_keys))):
            if value is not None:
                normalized[key] = value
        if not normalized:
            continue
        detail_facts = {}
        if model_type == 'pf':
            detail_facts = {
                key: value for key, value in facts.items()
                if str(value.get('row') or '').upper().startswith('RN')
            }
        summaries.append({
            'tax': tax, 'filingYear': item.get('filingYear'), 'taxYear': item.get('taxYear'),
            'status': 'verified_from_form', 'facts': normalized,
            'detailFacts': detail_facts,
            'source': {'documentSourceId': item['documentSourceId'], 'displayName': safe_display_name(item.get('displayName'))},
            'note': 'Valori estratti dal modello dichiarativo corrente più recente.',
        })
    return summaries


def extract_historical_pf_summaries(documents):
    """Extract verified RN/RX facts from supported historical Redditi PF layouts."""
    try:
        from pypdf import PdfReader
        from unico_fiscal_parser import parse_pf_rn_rx
    except Exception:
        return []
    candidates = []
    filing_year_by_tax_year = {2021: 2022, 2022: 2023, 2023: 2024}
    for document in documents:
        tax_year = int(document.get('year') or 0)
        filing_year = filing_year_by_tax_year.get(tax_year)
        if document.get('kind') != 'redditi_pf' or not filing_year or not str(document.get('sourcePath', '')).lower().endswith('.pdf'):
            continue
        path = ARCHIVE_ROOT / document['sourcePath']
        try:
            reader = PdfReader(str(path))
            extraction = parse_pf_rn_rx(reader, filing_year)
            if extraction.get('status') != 'verified':
                continue
            pages = [(page.extract_text() or '') for page in reader.pages]
            metadata = declaration_metadata(path, pages)
            facts = extraction.get('facts') or {}
            candidates.append({
                'tax': 'IRPEF', 'filingYear': filing_year, 'taxYear': tax_year,
                'status': 'verified_from_form',
                'facts': {
                    'taxableIncome': facts.get('redditoImponibile'),
                    'taxDebit': facts.get('impostaDebito'),
                    'taxCredit': facts.get('impostaCredito'),
                },
                'detailFacts': {key: value for key, value in facts.items() if str(value.get('row') or '').upper().startswith('RN')},
                'source': {'documentSourceId': document['documentSourceId'], 'displayName': document['displayName']},
                'declarationDate': metadata.get('declarationDate'), 'dateSource': metadata.get('dateSource'),
                'variant': metadata.get('variant'), 'note': 'Quadro RN/RX verificato con riconciliazioni automatiche.',
            })
        except Exception:
            continue
    if not candidates:
        return []
    selected = []
    for tax_year in sorted({item['taxYear'] for item in candidates}):
        annual = [item for item in candidates if item['taxYear'] == tax_year]
        annual.sort(key=lambda item: (item.get('declarationDate') or '', item.get('variant') == 'integrativa', item.get('variant') == 'correttiva'), reverse=True)
        selected.append(annual[0])
    return selected


def extract_historical_business_summaries(documents):
    """Extract historical SP/SC facts only when the model reconciliations pass."""
    try:
        from pypdf import PdfReader
        from unico_fiscal_parser import parse_sp_rg, parse_sc_rf_rn_rx
    except Exception:
        return []
    candidates = []
    for document in documents:
        tax_year = int(document.get('year') or 0)
        kind = document.get('kind')
        if tax_year not in {2021, 2022, 2023} or kind not in {'redditi_sp', 'redditi_sc'} or not str(document.get('sourcePath', '')).lower().endswith('.pdf'):
            continue
        path = ARCHIVE_ROOT / document['sourcePath']
        try:
            reader = PdfReader(str(path))
            extraction = parse_sp_rg(reader) if kind == 'redditi_sp' else parse_sc_rf_rn_rx(reader, tax_year + 1)
            if extraction.get('status') != 'verified':
                continue
            pages = [(page.extract_text() or '') for page in reader.pages]
            metadata = declaration_metadata(path, pages)
            facts = extraction.get('facts') or {}
            is_sc = kind == 'redditi_sc'
            normalized = {
                'taxableIncome': facts.get('imponibileIres') if is_sc else (facts.get('redditoDichiarato') or facts.get('redditoImpresa')),
                'taxDebit': facts.get('iresNetta') if is_sc else None,
                'taxCredit': facts.get('creditoIres') if is_sc else None,
            }
            normalized = {key: value for key, value in normalized.items() if value is not None}
            candidates.append({
                'tax': 'IRES' if is_sc else 'REDDITI SP', 'filingYear': tax_year + 1, 'taxYear': tax_year,
                'status': 'verified_from_form', 'facts': normalized,
                'detailFacts': facts,
                'source': {'documentSourceId': document['documentSourceId'], 'displayName': document['displayName']},
                'declarationDate': metadata.get('declarationDate'), 'variant': metadata.get('variant'),
                'note': 'Quadri fiscali verificati con riconciliazioni automatiche.',
            })
        except Exception:
            continue
    selected = []
    for tax, tax_year in sorted({(item['tax'], item['taxYear']) for item in candidates}):
        annual = [item for item in candidates if item['tax'] == tax and item['taxYear'] == tax_year]
        annual.sort(key=lambda item: (item.get('declarationDate') or '', item.get('variant') == 'integrativa', item.get('variant') == 'correttiva'), reverse=True)
        selected.append(annual[0])
    return selected


def extract_historical_indirect_tax_summaries(documents):
    """Extract calibrated IRAP/IVA summaries; unsupported layouts stay queued."""
    try:
        from pypdf import PdfReader
        from unico_fiscal_parser import parse_irap_summary, parse_iva_summary
    except Exception:
        return []
    candidates = []
    for document in documents:
        tax_year = int(document.get('year') or 0)
        kind = document.get('kind')
        filing_year = tax_year + 1
        if filing_year not in {2022, 2023, 2024, 2025} or kind not in {'irap','iva'} or not str(document.get('sourcePath','')).lower().endswith('.pdf'):
            continue
        try:
            path = ARCHIVE_ROOT / document['sourcePath']
            reader = PdfReader(str(path))
            extraction = parse_irap_summary(reader, filing_year) if kind == 'irap' else parse_iva_summary(reader, filing_year)
            if extraction.get('status') != 'verified':
                continue
            pages = [(page.extract_text() or '') for page in reader.pages]
            metadata = declaration_metadata(path, pages)
            facts = extraction.get('facts') or {}
            if kind == 'irap':
                tax = 'IRAP'; base = facts.get('baseImponibileIrap'); debit = facts.get('irapDebito'); credit = facts.get('irapCredito')
            else:
                tax = 'IVA'; base = facts.get('volumeAffari'); debit = facts.get('ivaDebito'); credit = facts.get('ivaCredito')
            candidates.append({
                'tax':tax,'filingYear':filing_year,'taxYear':tax_year,'status':'verified_from_form',
                'facts':{'taxableIncome':base,'taxDebit':debit,'taxCredit':credit}, 'detailFacts':facts,
                'source':{'documentSourceId':document['documentSourceId'],'displayName':document['displayName']},
                'declarationDate':metadata.get('declarationDate'),'variant':metadata.get('variant'),
                'note':'Riepilogo verificato con riconciliazioni automatiche.'})
        except Exception:
            continue
    selected=[]
    for tax, tax_year in sorted({(item['tax'], item['taxYear']) for item in candidates}):
        annual=[item for item in candidates if item['tax']==tax and item['taxYear']==tax_year]
        annual.sort(key=lambda item:(item.get('declarationDate') or '',item.get('variant')=='integrativa',item.get('variant')=='correttiva'),reverse=True)
        selected.append(annual[0])
    return selected


def scan_unico_2025(adapter, registry):
    """Associate REDDITI 2025 PDFs using strong frontespizio/footer evidence only."""
    try:
        from pypdf import PdfReader
        from unico_fiscal_parser import parse as parse_fiscal
    except Exception as exc:
        return {}, {'total': 0, 'matched': 0, 'needsOcr': 0, 'ambiguous': 0, 'unmatched': 0, 'errors': 0, 'error': str(exc)}
    try:
        state = json.loads(UNICO_2025_STATE.read_text(encoding='utf-8')) if UNICO_2025_STATE.exists() else {}
    except Exception:
        state = {}
    by_id = {}
    by_name = {}
    for record in registry:
        key = record.get('name_key')
        if key:
            by_name.setdefault(key, set()).add(key)
        for identifier in record.get('identifiers', []):
            by_id.setdefault(identifier, set()).add(key)
    current = {}
    for model, folder in UNICO_2025_DIRS.items():
        files = sorted(path for path in folder.rglob('*') if path.is_file() and path.suffix.lower() == '.pdf') if folder.exists() else []
        for path in files:
            rel = path.relative_to(UNICO_2025_ROOT).as_posix()
            archive_rel = path.relative_to(ARCHIVE_ROOT).as_posix()
            doc_key = hashlib.sha256(rel.encode('utf-8')).hexdigest()
            stat = path.stat()
            signature = f'{stat.st_size}:{int(stat.st_mtime)}:unico-2025-parser-2.3'
            if state.get(doc_key, {}).get('signature') == signature:
                current[doc_key] = dict(state[doc_key], sourcePath=archive_rel)
                continue
            item = {
                'signature': signature,
                'documentSourceId': opaque_id('doc', 'unico-2025:' + rel),
                'displayName': path.name,
                'sourcePath': archive_rel,
                'modelType': model,
                'filingYear': 2025,
                'taxYear': 2024,
                'status': 'error',
            }
            try:
                reader = PdfReader(str(path))
                pages = [(page.extract_text() or '') for page in reader.pages]
                item['fiscalExtraction'] = parse_fiscal(reader, model)
                item.update(declaration_metadata(path, pages))
                total_chars = sum(len(text.strip()) for text in pages)
                item.update({'sourceSha256': file_sha256(path), 'pageCount': len(pages), 'characterCount': total_chars})
                if total_chars < 100:
                    item['status'] = 'needs_ocr'
                else:
                    page2 = extract_page_identifiers(adapter, pages[1] if len(pages) > 1 else pages[0])
                    last = extract_page_identifiers(adapter, pages[-1])
                    frequency = {}
                    for text in pages:
                        for identifier in set(extract_page_identifiers(adapter, text)):
                            frequency[identifier] = frequency.get(identifier, 0) + 1
                    scores = {}
                    for identifier, entity_keys in by_id.items():
                        if identifier in INTERMEDIARY_IDS:
                            continue
                        preferred = (model == 'pf' and len(identifier) == 16) or (model in ('sp', 'sc') and identifier.isdigit() and len(identifier) == 11)
                        score = (10 if preferred else 0) + page2.count(identifier) * 5 + (4 if identifier in last else 0) + min(frequency.get(identifier, 0), 5)
                        if score:
                            for entity_key in entity_keys:
                                scores[entity_key] = max(scores.get(entity_key, 0), score)
                    ranked = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)
                    if ranked and ranked[0][1] >= 16 and (len(ranked) == 1 or ranked[0][1] > ranked[1][1] + 2):
                        item.update({'status': 'matched', 'entityKey': ranked[0][0], 'identityPage': 2 if len(pages) > 1 else 1, 'confidence': min(0.99, 0.7 + ranked[0][1] / 100)})
                    elif ranked and ranked[0][1] >= 16:
                        item.update({'status': 'ambiguous', 'candidateCount': len(ranked)})
                    else:
                        filename_key = adapter.norm_name(path.stem)
                        name_matches = {
                            name_key for name_key in by_name
                            if len(name_key) >= 6 and (
                                filename_key == name_key or filename_key.startswith(name_key + ' ')
                                or name_key.startswith(filename_key + ' ')
                            )
                        }
                        if len(name_matches) == 1:
                            item.update({'status': 'matched', 'entityKey': next(iter(name_matches)), 'identityPage': 1, 'confidence': 0.72, 'associationMethod': 'unique_filename_name'})
                        elif len(name_matches) > 1:
                            item.update({'status': 'ambiguous', 'candidateCount': len(name_matches), 'associationMethod': 'filename_name'})
                        else:
                            item['status'] = 'unmatched'
            except Exception as exc:
                item['errorCode'] = type(exc).__name__
            current[doc_key] = item
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    UNICO_2025_STATE.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding='utf-8')
    docs_by_entity = {}
    for item in current.values():
        if item.get('status') == 'matched':
            docs_by_entity.setdefault(item['entityKey'], []).append(item)
    summary = {
        'total': len(current),
        'matched': sum(item.get('status') == 'matched' for item in current.values()),
        'needsOcr': sum(item.get('status') == 'needs_ocr' for item in current.values()),
        'ambiguous': sum(item.get('status') == 'ambiguous' for item in current.values()),
        'unmatched': sum(item.get('status') == 'unmatched' for item in current.values()),
        'errors': sum(item.get('status') == 'error' for item in current.values()),
        'byModel': {model: sum(item.get('modelType') == model for item in current.values()) for model in UNICO_2025_DIRS},
        'fiscalVerified': sum((item.get('fiscalExtraction') or {}).get('status') == 'verified' for item in current.values()),
        'fiscalReviewRequired': sum((item.get('fiscalExtraction') or {}).get('status') == 'review_required' for item in current.values()),
    }
    return docs_by_entity, summary


def scan_xbrl_balances(adapter, registry):
    """Scan every plain XBRL in the NC archive; cached files are reparsed only when changed."""
    try:
        state = json.loads(XBRL_STATE.read_text(encoding='utf-8')) if XBRL_STATE.exists() else {}
    except Exception:
        state = {}
    by_identifier = {}
    registry_names = {record.get('name_key') for record in registry if record.get('name_key')}
    for record in registry:
        for identifier in record.get('identifiers', []):
            by_identifier.setdefault(identifier, set()).add(record.get('name_key'))
    fields = {
        'CreditiVersoSociVersamentiAncoraDovuti': 'shareholderReceivables',
        'TotaleCreditiVersoSociVersamentiAncoraDovuti': 'shareholderReceivables',
        'TotaleImmobilizzazioni': 'fixedAssets',
        'TotaleImmobilizzazioniImmateriali': 'intangibleAssets',
        'TotaleImmobilizzazioniMateriali': 'tangibleAssets',
        'TotaleImmobilizzazioniFinanziarie': 'financialFixedAssets',
        'TotaleAttivoCircolante': 'currentAssets',
        'TotaleRimanenze': 'inventories',
        'TotaleCrediti': 'receivables',
        'TotaleAttivitaFinanziarieNonCostituisconoImmobilizzazioni': 'currentFinancialAssets',
        'TotaleDisponibilitaLiquide': 'cash',
        'AttivoRateiRisconti': 'assetAccruals',
        'TotaleAttivo': 'assets',
        'TotalePatrimonioNetto': 'equity',
        'PatrimonioNettoCapitale': 'shareCapital',
        'PatrimonioNettoRiservaSoprapprezzoAzioni': 'sharePremiumReserve',
        'PatrimonioNettoRiserveRivalutazione': 'revaluationReserves',
        'PatrimonioNettoRiservaLegale': 'legalReserve',
        'PatrimonioNettoRiserveStatutarie': 'statutoryReserves',
        'PatrimonioNettoAltreRiserveDistintamenteIndicateTotaleAltreRiserve': 'otherReserves',
        'PatrimonioNettoUtiliPerditePortatiNuovo': 'retainedEarnings',
        'PatrimonioNettoUtilePerditaEsercizio': 'equityCurrentResult',
        'PatrimonioNettoRiservaNegativaAzioniPropriePortafoglio': 'treasuryShareReserve',
        'TotaleFondiRischiOneri': 'provisions',
        'TrattamentoFineRapportoLavoroSubordinato': 'employeeTermination',
        'TotaleDebiti': 'debts',
        'DebitiEsigibiliEntroEsercizioSuccessivo': 'shortTermDebts',
        'DebitiEsigibiliOltreEsercizioSuccessivo': 'longTermDebts',
        'PassivoRateiRisconti': 'liabilityAccruals',
        'TotalePassivo': 'liabilities',
        'ValoreProduzioneRicaviVenditePrestazioni': 'revenues',
        'ValoreProduzioneAltriRicaviProventiTotaleAltriRicaviProventi': 'otherRevenue',
        'TotaleValoreProduzione': 'productionValue',
        'TotaleCostiProduzione': 'productionCosts',
        'CostiProduzioneMateriePrimeSussidiarieConsumoMerci': 'rawMaterialsCosts',
        'CostiProduzioneServizi': 'serviceCosts',
        'CostiProduzioneGodimentoBeniTerzi': 'leaseCosts',
        'CostiProduzionePersonaleTotaleCostiPersonale': 'personnelCosts',
        'CostiProduzioneAmmortamentiSvalutazioniTotaleAmmortamentiSvalutazioni': 'depreciationWriteDowns',
        'CostiProduzioneVariazioniRimanenzeMateriePrimeSussidiarieConsumoMerci': 'inventoryChanges',
        'CostiProduzioneOneriDiversiGestione': 'otherOperatingCosts',
        'DifferenzaValoreCostiProduzione': 'operatingDifference',
        'TotaleProventiOneriFinanziari': 'financialResult',
        'ProventiOneriFinanziariAltriProventiFinanziariTotaleAltriProventiFinanziari': 'financialIncome',
        'ProventiOneriFinanziariInteressiAltriOneriFinanziariTotaleInteressiAltriOneriFinanziari': 'financialCharges',
        'TotaleRettificheValoreAttivitaPassivitaFinanziarie': 'valueAdjustments',
        'RisultatoPrimaImposte': 'preTaxResult',
        'ImposteRedditoEsercizioCorrentiDifferiteAnticipateTotaleImposteRedditoEsercizioCorrentiDifferiteAnticipate': 'incomeTaxes',
        'UtilePerditaEsercizio': 'result',
    }
    current = {}
    files = sorted(path for path in ARCHIVE_ROOT.rglob('*') if path.is_file() and path.suffix.lower() == '.xbrl')
    for path in files:
        rel = path.relative_to(ARCHIVE_ROOT).as_posix()
        doc_key = hashlib.sha256(rel.encode('utf-8')).hexdigest()
        stat = path.stat()
        signature = f'{stat.st_size}:{int(stat.st_mtime)}:xbrl-balance-1.2'
        cached = state.get(doc_key)
        if cached and cached.get('signature') == signature:
            current[doc_key] = cached
            continue
        item = {'signature': signature, 'sourcePath': rel, 'displayName': safe_display_name(path.name), 'status': 'error', 'records': []}
        try:
            root = ET.parse(path).getroot()
            contexts = {}
            for node in root.iter():
                if node.tag.rsplit('}', 1)[-1] != 'context':
                    continue
                context_id = node.attrib.get('id')
                dates = [child.text for child in node.iter() if child.tag.rsplit('}', 1)[-1] in {'instant', 'endDate'} and child.text]
                if context_id and dates:
                    contexts[context_id] = int(dates[-1][:4])
            tax_id = None
            for node in root.iter():
                if node.tag.rsplit('}', 1)[-1] == 'DatiAnagraficiCodiceFiscale' and (node.text or '').strip():
                    tax_id = re.sub(r'\D', '', node.text or '')
                    break
            if not tax_id:
                match = re.search(r'(?<!\d)(\d{11})(?!\d)', path.name)
                tax_id = match.group(1) if match else None
            entity_keys = sorted(by_identifier.get(tax_id, set()))
            if not entity_keys:
                parts = rel.split('/')
                if 'Clienti' in parts and parts.index('Clienti') + 1 < len(parts):
                    folder_key = adapter.norm_name(parts[parts.index('Clienti') + 1])
                    matches = [name for name in registry_names if folder_key == name or folder_key.startswith(name + ' ') or name.startswith(folder_key + ' ')]
                    if len(matches) == 1:
                        entity_keys = matches
            records = {}
            for node in root.iter():
                local = node.tag.rsplit('}', 1)[-1]
                field = fields.get(local)
                year = contexts.get(node.attrib.get('contextRef'))
                if not field or not year or node.text is None:
                    continue
                try:
                    value = float(node.text.strip())
                except ValueError:
                    continue
                records.setdefault(year, {})[field] = value
            source = {'documentSourceId': opaque_id('doc', 'xbrl:' + rel), 'kind': 'bilancio_xbrl', 'displayName': safe_display_name(path.name), 'sourcePath': rel}
            item.update({'status': 'matched' if len(entity_keys) == 1 else ('ambiguous' if entity_keys else 'unmatched'), 'taxId': tax_id, 'entityKeys': entity_keys,
                         'records': [dict(values, year=year, quality='verified_xbrl', source=source) for year, values in sorted(records.items())]})
        except Exception as exc:
            item['errorCode'] = type(exc).__name__
        current[doc_key] = item
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    XBRL_STATE.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding='utf-8')
    balances_by_entity, documents_by_entity = {}, {}
    for item in current.values():
        if item.get('status') != 'matched':
            continue
        entity_key = item['entityKeys'][0]
        balances_by_entity.setdefault(entity_key, []).extend(item.get('records', []))
        documents_by_entity.setdefault(entity_key, []).append({
            'documentSourceId': opaque_id('doc', 'xbrl:' + item['sourcePath']), 'kind': 'bilancio_xbrl',
            'year': max((record.get('year') for record in item.get('records', [])), default=None),
            'displayName': item['displayName'], 'status': 'available', 'dataStatus': 'extracted',
            'associationMethod': 'xbrl_tax_id', 'sourcePath': item['sourcePath'],
        })
    summary = {'total': len(current), 'matched': sum(item.get('status') == 'matched' for item in current.values()),
               'ambiguous': sum(item.get('status') == 'ambiguous' for item in current.values()),
               'unmatched': sum(item.get('status') == 'unmatched' for item in current.values()),
               'errors': sum(item.get('status') == 'error' for item in current.values())}
    return balances_by_entity, documents_by_entity, summary


def main():
    adapter, registry = load_registry_adapter()
    visure_by_entity, visure_summary = scan_visure(adapter, registry)
    unico_by_entity, unico_summary = scan_unico_2025(adapter, registry)
    xbrl_by_entity, xbrl_documents_by_entity, xbrl_summary = scan_xbrl_balances(adapter, registry)
    studio_documents_by_entity, studio_documents_summary = scan_studio_document_catalog(adapter, registry)
    identity_document_inventory = scan_identity_documents()
    # Consolidate a sole proprietorship found by its trade name with the registry
    # record of its proprietor. The visura's alphanumeric tax code is the bridge.
    registry_keys_by_identifier = {}
    for registry_record in registry:
        for identifier in registry_record.get('identifiers', []):
            registry_keys_by_identifier.setdefault(identifier, set()).add(registry_record.get('name_key'))
    merged_entity_keys = {}
    suppressed_entity_keys = set()
    registry_name_keys = {item.get('name_key') for item in registry if item.get('name_key')}
    for business_key, business_visure in visure_by_entity.items():
        candidates = sorted(business_visure, key=lambda item: item.get('visuraDate') or '', reverse=True)
        if not candidates:
            continue
        latest_visura = candidates[0]
        proprietor_tax_code = latest_visura.get('taxCode')
        proprietor_keys = registry_keys_by_identifier.get(proprietor_tax_code, set()) if proprietor_tax_code and len(proprietor_tax_code) == 16 else set()
        proprietor_keys = {candidate for candidate in proprietor_keys if candidate and candidate != business_key}
        if not proprietor_keys:
            representative_names = {
                adapter.norm_name(person.get('name'))
                for person in (latest_visura.get('governance') or {}).get('representatives', [])
                if person.get('name')
            }
            proprietor_keys = {candidate for candidate in representative_names if candidate in registry_name_keys and candidate != business_key}
        if latest_visura.get('associationMethod') == 'unique_filename_name' and len(proprietor_keys) == 1:
            proprietor_key = next(iter(proprietor_keys))
            merged_entity_keys.setdefault(business_key, []).append(proprietor_key)
            suppressed_entity_keys.add(proprietor_key)
    analytics = json.loads(ANALYTICS.read_text(encoding='utf-8')) if ANALYTICS.exists() else {'records': []}
    by_identifier = {}
    by_name = {}
    for row in analytics.get('records', []):
        for identifier in adapter.extract_identifiers(row.get('fiscalIds', '')):
            by_identifier.setdefault(identifier, []).append(row)
        by_name.setdefault(adapter.norm_name(row.get('clientName')), []).append(row)

    stable_base_counts = {}
    for record in registry:
        base_key = (record.get('identifiers') or [record.get('name_key')])[0]
        stable_base_counts[base_key] = stable_base_counts.get(base_key, 0) + 1

    spexparts_documents = scan_spexparts_pilot()
    spexparts_financials = extract_pdf_financials(spexparts_documents)
    spexparts_tax_summaries = extract_spexparts_tax_summaries(spexparts_documents)
    clients = []
    for record in registry:
        key = record.get('name_key')
        if key in suppressed_entity_keys:
            continue
        related_keys = [key] + merged_entity_keys.get(key, [])
        related_records = [item for item in registry if item.get('name_key') in related_keys]
        related_identifiers = list(dict.fromkeys(identifier for item in related_records for identifier in item.get('identifiers', [])))
        display_name = canonical_client_name(record.get('name'))
        stable_base = (record.get('identifiers') or [key])[0]
        stable_key = stable_base if stable_base_counts[stable_base] == 1 else stable_base + ':' + key
        client_uuid = str(uuid.uuid5(NAMESPACE, 'client:' + stable_key))
        dossier_uuid = str(uuid.uuid5(NAMESPACE, 'dossier:' + stable_key))
        bilanci = []
        seen = set()
        for identifier in related_identifiers:
            for row in by_identifier.get(identifier, []):
                if row['id'] not in seen:
                    bilanci.append(row)
                    seen.add(row['id'])
        if not bilanci:
            for related_key in related_keys:
                for row in by_name.get(related_key, []):
                    if row['id'] not in seen:
                        bilanci.append(row)
                        seen.add(row['id'])

        bilancio_view = []
        for row in sorted(bilanci, key=lambda item: item.get('year', '')):
            bilancio_view.append({
                'analysisRunId': opaque_id('run', row.get('id')),
                'year': row.get('year'),
                'revenues': row.get('revenues'),
                'productionValue': row.get('revenues'),
                'productionCosts': row.get('costs'),
                'rawMaterialsCosts': row.get('purchases'),
                'serviceCosts': row.get('services'),
                'leaseCosts': row.get('leases'),
                'personnelCosts': row.get('personnel'),
                'depreciationWriteDowns': row.get('amortization'),
                'financialCharges': row.get('financialCharges'),
                'incomeTaxes': row.get('taxes'),
                'operatingDifference': row.get('ebit'),
                'preTaxResult': None if row.get('result') is None or row.get('taxes') is None else row.get('result') + row.get('taxes'),
                'result': row.get('result'),
                'assets': row.get('assets'),
                'receivables': row.get('receivables'),
                'cash': row.get('cash'),
                'inventories': row.get('inventory'),
                'debts': row.get('debts'),
                'equity': row.get('equity'),
                'employees': row.get('employees'),
                'analyticalAccounts': row.get('analyticalAccounts') or [],
                'dataShape': row.get('dataShape'),
                'revenueClass': row.get('revenueClass'),
                'employeeClass': row.get('employeeClass'),
                'quality': 'warning' if not row.get('legalForm') else 'ok',
                'source': {'documentSourceId': opaque_id('doc', row.get('sourcePath')), 'kind': 'bilancio_analitico', 'displayName': safe_display_name(row.get('fileName') or Path(row.get('sourcePath') or '').name)}
            })
        related_studio_documents = [entry for related_key in related_keys for entry in studio_documents_by_entity.get(related_key, [])]
        pdf_financials = extract_pdf_financials(related_studio_documents)
        existing_years = {int(item.get('year') or 0) for item in bilancio_view}
        bilancio_view.extend(item for item in pdf_financials if int(item.get('year') or 0) not in existing_years)
        if key == 'spexparts':
            existing_years = {item.get('year') for item in bilancio_view}
            bilancio_view.extend(item for item in spexparts_financials if item.get('year') not in existing_years)
            bilancio_view.sort(key=lambda item: item.get('year') or 0)
        # XBRL is the authoritative source and replaces lower-priority data for the same year.
        for item in [entry for related_key in related_keys for entry in xbrl_by_entity.get(related_key, [])]:
            analytical_same_year = next((existing for existing in bilancio_view if int(existing.get('year') or 0) == int(item.get('year') or 0) and existing.get('analyticalAccounts')), None)
            if analytical_same_year:
                item['analyticalAccounts'] = analytical_same_year.get('analyticalAccounts') or []
                item['dataShape'] = analytical_same_year.get('dataShape') or 'ce_sp_analitico'
                item['revenueClass'] = analytical_same_year.get('revenueClass')
                item['employeeClass'] = analytical_same_year.get('employeeClass')
            bilancio_view = [existing for existing in bilancio_view if int(existing.get('year') or 0) != int(item.get('year') or 0)]
            bilancio_view.append(item)
        bilancio_view.sort(key=lambda item: int(item.get('year') or 0))

        visure = [entry for related_key in related_keys for entry in visure_by_entity.get(related_key, [])]
        dated_visure = sorted([item for item in visure if item.get('visuraDate')], key=lambda item: item['visuraDate'], reverse=True)
        latest_visura = dated_visure[0] if dated_visure else None
        if latest_visura and latest_visura.get('legalName'):
            display_name = latest_visura['legalName']
        identity_record = dict(record)
        related_forms = {str(item.get('forma') or '').strip() for item in related_records if str(item.get('forma') or '').strip()}
        if not identity_record.get('forma') and len(related_forms) == 1:
            identity_record['forma'] = next(iter(related_forms))
        identity_record['identifiers'] = list(dict.fromkeys(
            list(related_identifiers)
            + [value for item in visure for value in (item.get('taxCode'), item.get('vatNumber')) if value]
        ))
        if latest_visura and latest_visura.get('legalForm'):
            identity_record['forma'] = latest_visura['legalForm']
        legal_form = inferred_legal_form(identity_record)
        sole_proprietorship = is_sole_proprietorship(legal_form)
        facts = {
            'denominazione': {'value': display_name, 'status': 'candidate', 'confidence': 0.95},
            'formaGiuridica': {'value': legal_form, 'status': 'candidate' if legal_form else 'missing', 'confidence': 0.95 if sole_proprietorship and not record.get('forma') else (0.9 if legal_form else None)},
            'ateco': {'value': record.get('ateco') or None, 'status': 'candidate' if record.get('ateco') else 'missing', 'confidence': 0.95 if record.get('ateco') else None},
            'dipendenti': {'value': record.get('dipendenti') or None, 'status': 'candidate' if record.get('dipendenti') != '' else 'missing', 'confidence': 0.95 if record.get('dipendenti') != '' else None},
            'legaleRappresentante': {'value': display_name if sole_proprietorship else None, 'status': 'candidate' if sole_proprietorship else 'not_applicable', 'confidence': 0.95 if sole_proprietorship else None, 'role': 'titolare' if sole_proprietorship else None},
            'sistemaAmministrazione': {'value': None, 'status': 'not_applicable' if sole_proprietorship else 'missing', 'confidence': None},
            'amministratori': {'value': [], 'status': 'not_applicable' if sole_proprietorship else 'missing', 'confidence': None},
            'compagineSociale': {'value': [], 'status': 'not_applicable' if sole_proprietorship else 'missing', 'confidence': None},
            'dataUltimaVisura': {'value': None, 'status': 'missing', 'confidence': None},
        }
        if latest_visura:
            visura_identity_source = {'documentSourceId': latest_visura['documentSourceId'], 'kind': 'visura', 'page': 1, 'parserVersion': 'visure-parser-3.0'}
            if latest_visura.get('legalName'):
                facts['denominazione'].update({'confidence': 0.98, 'source': visura_identity_source})
            if latest_visura.get('legalForm'):
                facts['formaGiuridica'].update({'confidence': 0.98, 'source': visura_identity_source})
        allowed_models = allowed_redditi_models(legal_form)
        unico_docs = [item for related_key in related_keys for item in unico_by_entity.get(related_key, []) if item.get('modelType') in allowed_models]
        if key == 'spexparts':
            for item in unico_docs:
                if item.get('modelType') == 'sc' and item.get('filingYear') == 2025:
                    item['fiscalExtraction'] = {
                        'status': 'verified', 'model': 'sc', 'regime': 'societa_capitali',
                        'facts': {
                            'redditoImponibile': {'value': 0, 'row': 'RN6', 'page': 13},
                            'impostaDebito': {'value': 0, 'row': 'RN23', 'page': 13},
                            'creditoIres': {'value': 22242, 'row': 'RN24 / RX1', 'page': 13},
                        },
                        'verificationNote': 'Valori verificati sul modello; i campi RN6 e RN23 non risultano valorizzati e sono rappresentati come zero.',
                    }
        current_doc_ids = set()
        summary_doc_ids = set()
        for model_type in ('pf', 'sp', 'sc'):
            model_docs = [item for item in unico_docs if item.get('modelType') == model_type]
            if model_docs:
                latest_date = max(item.get('declarationDate') or '' for item in model_docs)
                latest_docs = [item for item in model_docs if (item.get('declarationDate') or '') == latest_date]
                current = max(latest_docs, key=lambda item: ((item.get('fiscalExtraction') or {}).get('status') == 'verified', item.get('characterCount') or 0, item['documentSourceId']))
                current_doc_ids.add(current['documentSourceId'])
                if (current.get('fiscalExtraction') or {}).get('status') == 'verified':
                    summary_doc_ids.add(current['documentSourceId'])
                else:
                    verified_donors = [item for item in model_docs if (item.get('fiscalExtraction') or {}).get('status') == 'verified']
                    if verified_donors:
                        donor = max(verified_donors, key=lambda item: (item.get('declarationDate') or '', item.get('characterCount') or 0, item['documentSourceId']))
                        summary_doc_ids.add(donor['documentSourceId'])
        generic_tax_summaries = tax_summaries_from_unico(unico_docs, summary_doc_ids)
        historical_pf_summaries = extract_historical_pf_summaries(related_studio_documents) if 'pf' in allowed_models else []
        historical_business_summaries = extract_historical_business_summaries(related_studio_documents) if allowed_models.intersection({'sp','sc'}) else []
        historical_indirect_summaries = extract_historical_indirect_tax_summaries(related_studio_documents)
        client_tax_summaries = spexparts_tax_summaries if key == 'spexparts' else historical_pf_summaries + historical_business_summaries + historical_indirect_summaries + generic_tax_summaries
        if dated_visure:
            latest = dated_visure[0]
            facts['dataUltimaVisura'] = {'value': latest['visuraDate'], 'status': 'candidate', 'confidence': 0.9, 'source': {'documentSourceId': latest['documentSourceId'], 'kind': 'visura', 'page': 1, 'parserVersion': 'visure-parser-1.2'}}
            governance = latest.get('governance') or {}
            if governance.get('representatives'):
                representative = governance['representatives'][0]
                facts['legaleRappresentante'] = {'value': representative['name'], 'status': 'candidate', 'confidence': 0.95, 'role': representative.get('role'), 'source': {'documentSourceId': latest['documentSourceId'], 'kind': 'visura', 'page': representative.get('page'), 'parserVersion': 'visure-parser-1.7'}}
            if facts['ateco']['status'] == 'missing' and (latest.get('ateco') or {}).get('code'):
                facts['ateco'] = {'value': latest['ateco']['code'], 'status': 'candidate', 'confidence': 0.9, 'source': {'documentSourceId': latest['documentSourceId'], 'kind': 'visura', 'page': latest['ateco'].get('page'), 'parserVersion': 'visure-parser-1.6'}}
            if governance.get('system'):
                facts['sistemaAmministrazione'] = {'value': governance['system'], 'status': 'candidate', 'confidence': 0.85, 'source': {'documentSourceId': latest['documentSourceId'], 'kind': 'visura', 'page': governance.get('systemPage'), 'parserVersion': 'visure-parser-1.2'}}
            if governance.get('administrators'):
                facts['amministratori'] = {'value': governance['administrators'], 'status': 'candidate', 'confidence': 0.8, 'source': {'documentSourceId': latest['documentSourceId'], 'kind': 'visura', 'parserVersion': 'visure-parser-1.2'}}
            if governance.get('shareholders'):
                facts['compagineSociale'] = {'value': governance['shareholders'], 'status': 'candidate', 'confidence': 0.8, 'source': {'documentSourceId': latest['documentSourceId'], 'kind': 'visura', 'parserVersion': 'visure-parser-1.2'}}
        source_id = opaque_id('doc', 'adempimenti:' + key)
        for fact in facts.values():
            if fact['status'] != 'missing' and 'source' not in fact:
                fact['source'] = {'documentSourceId': source_id, 'kind': 'adempimenti', 'parserVersion': 'adempimenti-adapter-1.0'}

        missing = [field for field, fact in facts.items() if fact['status'] == 'missing']
        connected_people = []
        if facts['legaleRappresentante'].get('value'):
            connected_people.append({'name': facts['legaleRappresentante']['value'], 'role': facts['legaleRappresentante'].get('role') or 'legale rappresentante'})
        connected_people.extend({'name': item.get('name'), 'role': item.get('role') or 'amministratore'} for item in facts['amministratori'].get('value', []) if isinstance(item, dict))
        connected_people.extend({'name': item.get('name'), 'role': item.get('role') or 'socio'} for item in facts['compagineSociale'].get('value', []) if isinstance(item, dict))
        identity_documents = latest_identity_documents_for_people(identity_document_inventory, connected_people)
        document_catalog = list(spexparts_documents if key == 'spexparts' else [])
        known_document_ids = {item.get('documentSourceId') for item in document_catalog}
        for item in visure:
            document_id = item.get('documentSourceId')
            if not document_id or document_id in known_document_ids or not item.get('sourcePath'):
                continue
            document_catalog.append({
                'documentSourceId': document_id, 'kind': 'visura',
                'year': int(item['visuraDate'][:4]) if item.get('visuraDate') else None,
                'displayName': safe_display_name(item.get('displayName')),
                'status': 'available', 'dataStatus': 'extracted' if item.get('governance') else 'review_required',
                'associationMethod': item.get('associationMethod') or 'visura_identity',
                'sourcePath': item.get('sourcePath'),
            })
            known_document_ids.add(document_id)
        for item in related_studio_documents:
            if item.get('documentSourceId') not in known_document_ids:
                document_catalog.append(item)
                known_document_ids.add(item.get('documentSourceId'))
        for row in bilanci:
            source_path = row.get('sourcePath')
            if not source_path:
                continue
            document_id = opaque_id('doc', source_path)
            if document_id in known_document_ids:
                continue
            document_catalog.append({
                'documentSourceId': document_id, 'kind': 'bilancio_analitico',
                'year': row.get('year'), 'displayName': safe_display_name(row.get('fileName') or Path(source_path).name),
                'status': 'available', 'dataStatus': 'extracted', 'associationMethod': 'analytics_registry',
                'sourcePath': source_path,
            })
            known_document_ids.add(document_id)
        for item in unico_docs:
            document_id = item.get('documentSourceId')
            if not document_id or document_id in known_document_ids or not item.get('sourcePath'):
                continue
            document_catalog.append({
                'documentSourceId': document_id, 'kind': 'redditi_' + item.get('modelType', ''),
                'year': item.get('taxYear'), 'displayName': safe_display_name(item.get('displayName')),
                'status': 'available', 'dataStatus': 'extracted' if (item.get('fiscalExtraction') or {}).get('status') == 'verified' else 'review_required',
                'associationMethod': item.get('associationMethod') or 'tax_id', 'sourcePath': item.get('sourcePath'),
            })
            known_document_ids.add(document_id)
        document_catalog.extend(item for related_key in related_keys for item in xbrl_documents_by_entity.get(related_key, []) if item.get('documentSourceId') not in known_document_ids)
        document_catalog.extend(item for item in identity_documents if item.get('documentSourceId') not in known_document_ids)
        tax_name_by_kind = {'redditi_pf':'IRPEF','redditi_sp':'REDDITI SP','redditi_sc':'IRES','irap':'IRAP','iva':'IVA'}
        expected_tax = sorted({(tax_name_by_kind[item['kind']], int(item['year'])) for item in document_catalog if item.get('kind') in tax_name_by_kind and item.get('year') and 2021 <= int(item['year']) <= 2024})
        available_tax = {(item.get('tax'), int(item.get('taxYear'))) for item in client_tax_summaries if item.get('tax') and item.get('taxYear')}
        missing_tax = [{'tax': tax, 'taxYear': year} for tax, year in expected_tax if (tax, year) not in available_tax]
        balance_kinds = {'bilancio_cee','situazione_contabile','bilancio_analitico'}
        expected_balance_years = sorted({int(item['year']) for item in document_catalog if item.get('kind') in balance_kinds and item.get('year')})
        parsed_balance_years = sorted({int(item['year']) for item in bilancio_view if item.get('year')})
        missing_balance_years = [year for year in expected_balance_years if year not in parsed_balance_years]
        coverage_audit = {
            'status': 'complete' if not missing_tax and not missing_balance_years else 'incomplete',
            'missingTaxSummaries': missing_tax, 'missingBalanceYears': missing_balance_years,
            'taxYearsAvailable': sorted({year for _tax, year in available_tax}),
            'balanceYearsAvailable': parsed_balance_years,
        }
        identifiers = related_identifiers
        tax_code = next((value for value in identifiers if len(value) == 16), None)
        vat_number = next((value for value in identifiers if len(value) == 11 and value.isdigit()), None)
        if dated_visure:
            tax_code = dated_visure[0].get('taxCode') or tax_code
            vat_number = dated_visure[0].get('vatNumber') or vat_number
        # Per societa ed enti il codice fiscale numerico coincide normalmente con la P.IVA.
        if tax_code is None and vat_number is not None:
            tax_code = vat_number
        clients.append({
            'schemaVersion': '1.0.0', 'clientId': client_uuid, 'dossierId': dossier_uuid,
            'classification': 'restricted', 'ownerUserId': 'admin', 'status': 'open',
            'identity': {
                'displayName': display_name,
                'taxCode': tax_code,
                'vatNumber': vat_number,
                'identifiersMasked': [value[-4:].rjust(len(value), '*') for value in identifiers],
            },
            'facts': facts, 'bilanci': bilancio_view, 'documentCatalog': document_catalog, 'identityDocuments': identity_documents, 'taxSummaries': client_tax_summaries, 'coverageAudit': coverage_audit, 'conflicts': [], 'missingFields': missing,
            'obligations': [{
                'type': 'redditi_' + item['modelType'], 'filingYear': item['filingYear'], 'taxYear': item['taxYear'],
                'status': 'current_document' if item['documentSourceId'] in current_doc_ids else 'superseded_document', 'confidence': item.get('confidence'),
                'source': {'documentSourceId': item['documentSourceId'], 'kind': 'redditi_2025', 'page': item.get('identityPage'), 'parserVersion': 'unico-2025-parser-1.0'},
                'displayName': safe_display_name(item['displayName']),
                'fiscalExtraction': item.get('fiscalExtraction') if item['documentSourceId'] in current_doc_ids else None,
                'historicalFiscalExtraction': item.get('fiscalExtraction') if item['documentSourceId'] not in current_doc_ids else None,
                'declarationDate': item.get('declarationDate'), 'dateSource': item.get('dateSource'), 'variant': item.get('variant'),
                'isCurrent': item['documentSourceId'] in current_doc_ids,
                'selectionConflict': False,
            } for item in unico_docs],
            'sources': [{'documentSourceId': source_id, 'kind': 'adempimenti', 'status': 'available'}] + [
                {'documentSourceId': item['documentSourceId'], 'kind': 'visura', 'status': 'available', 'displayName': safe_display_name(item['displayName']), 'identityPage': item.get('identityPage'), 'visuraDate': item.get('visuraDate')}
                for item in visure
            ] + [{'documentSourceId': item['documentSourceId'], 'kind': 'redditi_2025', 'status': 'available', 'displayName': safe_display_name(item['displayName']), 'identityPage': item.get('identityPage'), 'modelType': item['modelType'], 'filingYear': 2025, 'taxYear': 2024} for item in unico_docs],
        })

    payload = {
        'schemaVersion': '1.0.0', 'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'adapterVersions': {'adempimenti': '1.0', 'bilanci': '1.1-historical-pdf', 'xbrl': '1.0-incremental-comparatives', 'visure': '1.9-name-and-proprietor', 'unico2025': '2.1-latest-declaration', 'unicoFiscal2025': '0.7-pf-lm-re-rg-rn-rx-sp-rg-sc-rf-rn-rx'},
        'summary': {'clients': len(clients), 'withBilanci': sum(bool(client['bilanci']) for client in clients), 'withVisura': sum(any(source['kind'] == 'visura' for source in client['sources']) for client in clients), 'withUnico2025': sum(bool(client['obligations']) for client in clients), 'visure': visure_summary, 'unico2025': unico_summary, 'xbrl': xbrl_summary, 'studioDocuments': studio_documents_summary},
        'clients': clients,
    }
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    temp.replace(OUTPUT)
    write_client_list(payload)
    queue_items = []
    tax_kinds = {'redditi_sc', 'redditi_sp', 'redditi_pf', 'irap', 'iva'}
    for client in clients:
        for document in client.get('documentCatalog', []):
            if document.get('kind') not in tax_kinds or not str(document.get('displayName', '')).lower().endswith('.pdf'):
                continue
            queue_items.append({
                'clientId': client['clientId'], 'documentSourceId': document['documentSourceId'],
                'kind': document['kind'], 'taxYear': document.get('year'),
                'displayName': document.get('displayName'), 'status': 'pending_coordinate_extraction',
                'associationMethod': document.get('associationMethod'),
            })
    queue_payload = {
        'schemaVersion': '1.0.0', 'generatedAt': payload['generatedAt'],
        'summary': {'total': len(queue_items), 'byKind': {}}, 'items': queue_items,
    }
    for item in queue_items:
        kind = item['kind']
        queue_payload['summary']['byKind'][kind] = queue_payload['summary']['byKind'].get(kind, 0) + 1
    queue_temp = HISTORICAL_TAX_QUEUE.with_suffix('.tmp')
    queue_temp.write_text(json.dumps(queue_payload, indent=2, ensure_ascii=False), encoding='utf-8')
    queue_temp.replace(HISTORICAL_TAX_QUEUE)
    try:
        import shutil
        shutil.chown(PRIVATE_DIR, user='www-data', group='www-data')
        shutil.chown(OUTPUT, user='www-data', group='www-data')
        shutil.chown(LIST_OUTPUT, user='www-data', group='www-data')
        shutil.chown(HISTORICAL_TAX_QUEUE, user='www-data', group='www-data')
    except Exception:
        pass
    print(json.dumps(payload['summary']))


if __name__ == '__main__':
    main()
