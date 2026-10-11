#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path
sys.path.insert(0, '/var/www/html/studio-apps/document-worker/vendor')
from pypdf import PdfReader
from datetime import datetime

ROOT = Path('/var/www/html/data/admin/files/Revisioni').resolve()

def safe_folder(value):
    relative = str(value or '').replace('\\', '/').strip('/')
    if relative.lower().startswith('revisioni/'):
        relative = relative[len('Revisioni/'):]
    target = (ROOT / relative).resolve()
    try: target.relative_to(ROOT)
    except ValueError: raise ValueError('Percorso non consentito')
    if not target.is_dir(): raise FileNotFoundError('Cartella società non trovata')
    return target

def first_match(patterns, text):
    for pattern in patterns:
        match = re.search(pattern, text, re.I | re.M)
        if match: return re.sub(r'\s+', ' ', match.group(1)).strip(' .:-')
    return None

def company_name(text, fallback):
    labelled = first_match([
        r'(?:Denominazione|Ragione\s+sociale)\s*[:\-]?\s*([^\n]{3,160})',
        r'(?:Dati\s+anagrafici|Impresa)\s*\n\s*([^\n]{3,160})',
    ], text)
    if labelled: return labelled.upper()
    for raw in text.splitlines()[:80]:
        line = re.sub(r'\s+', ' ', raw).strip()
        if re.search(r'\b(S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?)\b', line, re.I) and 4 < len(line) < 160:
            return line.upper()
    return fallback.upper()

def legal_form(name):
    compact = re.sub(r'[^A-Z]', '', name.upper())
    if 'SRLUNIPERSONALE' in compact: return 'srl_unipersonale'
    if 'SRL' in compact: return 'srl'
    if 'SPA' in compact: return 'spa'
    if 'SNC' in compact: return 'snc'
    if 'SAS' in compact: return 'sas'
    return 'altro'

def extract_pdf_text(path, max_pages=40):
    try:
        reader = PdfReader(str(path))
        return '\n'.join((page.extract_text() or '') for page in reader.pages[:max_pages])
    except Exception:
        return ''

def italian_number(value):
    if not value: return None
    raw = re.sub(r'\s+', '', value)
    if re.fullmatch(r'-?\d{1,3}(?:\.\d{3})*(?:,\d+)?', raw):
        raw = raw.replace('.', '').replace(',', '.')
    else:
        raw = raw.replace(',', '.')
    try: return float(raw)
    except ValueError: return None

def amount_after(text, labels):
    for label in labels:
        pattern = re.escape(label) + r'[\s\S]{0,180}?(-?\d{1,3}(?:[\.\s]\d{3})*(?:,\d+)?)'
        match = re.search(pattern, text, re.I)
        value = italian_number(match.group(1)) if match else None
        if value is not None: return value
    return None

def balance_summary(path, year, status, reference_date=None):
    text = extract_pdf_text(path)
    values = {
        'ricavi': amount_after(text, ['ricavi delle vendite', 'ricavi vendite', 'totale valore della produzione']),
        'totaleAttivo': amount_after(text, ['totale attivo']),
        'patrimonioNetto': amount_after(text, ['totale patrimonio netto', 'patrimonio netto']),
        'utile': amount_after(text, ["utile (perdita) dell'esercizio", "utile dell'esercizio", "perdita dell'esercizio"]),
        'debitiTotali': amount_after(text, ['totale debiti']),
        'disponibilitaLiquide': amount_after(text, ['disponibilità liquide', 'disponibilita liquide']),
    }
    return {
        'path': path.relative_to(ROOT).as_posix(), 'name': path.name, 'year': year,
        'status': status, 'referenceDate': reference_date,
        'values': values, 'valuesFound': sum(v is not None for v in values.values()),
        'method': 'pdf_text_local',
    }

def date_iso(day, month, year):
    try: return datetime(int(year), int(month), int(day)).date().isoformat()
    except ValueError: return None

def durc_summary(path, engagement_year):
    text = extract_pdf_text(path, 12)
    dates = []
    for day, month, year in re.findall(r'\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b', text + '\n' + path.name):
        value = date_iso(day, month, year)
        if value: dates.append(value)
    expiry = first_match([
        r'(?:Scadenza\s+validit[aà]|Valido\s+fino\s+al|scad(?:enza)?)[^\d]{0,30}(\d{1,2}[./-]\d{1,2}[./-]20\d{2})'
    ], text + '\n' + path.name)
    if expiry:
        parts = re.split(r'[./-]', expiry)
        expiry = date_iso(parts[0], parts[1], parts[2])
    elif dates:
        expiry = max(dates)
    year_end = f'{engagement_year}-12-31'
    return {
        'path': path.relative_to(ROOT).as_posix(), 'name': path.name,
        'expiryDate': expiry, 'coversYearEnd': bool(expiry and expiry >= year_end),
        'status': 'confermato' if expiry else 'da_verificare', 'method': 'pdf_text_local',
    }

def audit_package(files, engagement_year):
    pdfs = [p for p in files if p.suffix.lower() == '.pdf']
    historical = []
    interim = []
    durcs = []
    for path in pdfs:
        value = (path.name + ' ' + path.parent.name).lower()
        years = [int(y) for y in re.findall(r'(?<!\d)(20\d{2})(?!\d)', value)]
        year = years[-1] if years else None
        is_balance = 'bilancio' in value and not re.search(r'relazione|verbale|nomina', value)
        if is_balance and year and year < engagement_year and re.search(r'completo|nota integrativa|prospetto|bilancio\s+31|fascicolo', value):
            historical.append(balance_summary(path, year, 'approvato_o_depositato'))
        elif is_balance and (year == engagement_year or str(engagement_year) in value) and re.search(r'provv|31[ _./-]*3|30[ _./-]*6|31[ _./-]*03|30[ _./-]*06', value):
            date_match = re.search(r'(31)[ _./-]*(?:0?3)|(?:30)[ _./-]*(?:0?6)', value)
            reference = f'{engagement_year}-03-31' if date_match and date_match.group(1) == '31' else f'{engagement_year}-06-30'
            interim.append(balance_summary(path, engagement_year, 'provvisorio', reference))
        if 'durc' in value:
            durcs.append(durc_summary(path, engagement_year))
    # Una sola fonte primaria per anno storico: privilegia il documento più completo e con più valori.
    per_year = {}
    for item in historical:
        score = item['valuesFound'] + (3 if re.search(r'completo|depositato|nota integrativa', item['name'], re.I) else 0)
        if item['year'] not in per_year or score > per_year[item['year']][0]: per_year[item['year']] = (score, item)
    historical = [per_year[y][1] for y in sorted(per_year)]
    current_scope = [p for p in files if str(engagement_year) in p.relative_to(ROOT).as_posix()]
    has_final_balance = any(
        p.suffix.lower() in ('.xbrl', '.xml') and 'bilancio' in p.name.lower()
        or p.suffix.lower() == '.pdf' and 'bilancio' in p.name.lower() and re.search(r'31[ _./-]*12', p.name.lower())
        for p in current_scope
    )
    has_current_note = any(p.suffix.lower() == '.pdf' and 'nota integrativa' in p.name.lower() for p in current_scope)
    missing = []
    if not any(item.get('coversYearEnd') for item in durcs): missing.append(f'DURC valido al 31/12/{engagement_year}')
    if not has_final_balance: missing.append(f'Bilancio definitivo {engagement_year}')
    if not has_current_note: missing.append(f'Nota integrativa {engagement_year}')
    return {
        'engagementYear': engagement_year,
        'historicalBalances': historical,
        'interimBalances': sorted(interim, key=lambda x: x.get('referenceDate') or ''),
        'durc': sorted(durcs, key=lambda x: x.get('expiryDate') or '', reverse=True),
        'missingDocuments': missing,
        'warnings': ['I dati infrannuali sono provvisori e non sostituiscono il bilancio definitivo.'],
    }

def standard_document_package(files, engagement_year):
    next_year_short = str(engagement_year + 1)[-2:]
    roles = {
        'bilancioXbrl': [], 'bilancioCivilistico': [], 'bilancioAnalitico': [],
        'notaIntegrativa': [], 'clienti': [], 'fornitori': [], 'partitarioGenerale': [],
        'estrattiContoSuccessivi': [], 'durc': []
    }
    for path in files:
        name = path.name.lower()
        relative = path.relative_to(ROOT).as_posix()
        ext = path.suffix.lower()
        year_token = str(engagement_year)
        shared_score = 4 if re.search(r'condivis|revision[ei][ /_-]*' + year_token, relative, re.I) else 0
        score = shared_score + (2 if year_token in name else 0)
        role = None
        if ext in ('.xbrl', '.xml') and 'bilancio' in name: role = 'bilancioXbrl'
        elif ext == '.pdf' and 'nota integrativa' in name: role = 'notaIntegrativa'
        elif ext == '.pdf' and 'bilancio' in name and not re.search(r'relazione|nota integrativa|verbale', name):
            head = extract_pdf_text(path, 2)
            if re.search(r'stampa dettaglio voci|codice\s+bdv|bilancio di verifica', head, re.I): role = 'bilancioAnalitico'
            else: role = 'bilancioCivilistico'
        elif ext in ('.xlsx', '.xls', '.csv') and re.search(r'fornitori?', name): role = 'fornitori'
        elif ext in ('.xlsx', '.xls', '.csv') and re.search(r'clienti?', name): role = 'clienti'
        elif ext in ('.xlsx', '.xls', '.csv') and re.search(r'partitari?|mastro|libro giornale', name): role = 'partitarioGenerale'
        elif ext == '.pdf' and re.search(r'estratt[oi].?conto|\bec\b', name) and (next_year_short in name or str(engagement_year + 1) in name): role = 'estrattiContoSuccessivi'
        elif ext == '.pdf' and 'durc' in name: role = 'durc'
        if role:
            readable = True
            requires_ocr = False
            if ext == '.pdf':
                text = extract_pdf_text(path, 2)
                readable = len(text.strip()) >= 80
                requires_ocr = not readable
            roles[role].append({'path': relative, 'name': path.name, 'extension': ext.lstrip('.'),
                                'score': score, 'readable': readable, 'requiresOcr': requires_ocr})
    for key in roles:
        roles[key] = sorted(roles[key], key=lambda x: (-x['score'], x['name'].lower()))
        if roles[key] and roles[key][0]['score'] >= 4:
            roles[key] = [item for item in roles[key] if item['score'] >= 4]

    def present(*keys): return all(len(roles[k]) > 0 for k in keys)
    bank_docs = roles['estrattiContoSuccessivi']
    bank_ready = bool(bank_docs) and all(x['readable'] or x['requiresOcr'] for x in bank_docs)
    stages = [
        {'id':'acquisizione', 'order':1, 'title':'Acquisizione e controllo documenti', 'status':'disponibile',
         'automaticChecks':['inventario file','hash e duplicati','leggibilità','periodo di riferimento']},
        {'id':'quadratura_bilancio', 'order':2, 'title':'Quadratura delle basi contabili',
         'status':'disponibile' if present('bilancioXbrl','bilancioAnalitico','partitarioGenerale') else 'bloccato',
         'requires':['bilancioXbrl','bilancioAnalitico','partitarioGenerale'],
         'automaticChecks':['XBRL vs bilancio analitico','bilancio analitico vs partitari','comparativo anno precedente']},
        {'id':'pianificazione', 'order':3, 'title':'Comprensione, materialità e rischi',
         'status':'disponibile' if present('bilancioXbrl','notaIntegrativa') else 'bloccato',
         'requires':['bilancioXbrl','notaIntegrativa'],
         'automaticChecks':['indici e trend','variazioni anomale','proposta materialità','aree significative']},
        {'id':'crediti_debiti', 'order':4, 'title':'Crediti, debiti e circolarizzazioni',
         'status':'disponibile' if present('clienti','fornitori') else 'bloccato',
         'requires':['clienti','fornitori'],
         'automaticChecks':['ricostruzione saldi','concentrazione','saldi anomali','selezione campioni']},
        {'id':'incassi_pagamenti', 'order':5, 'title':'Incassi e pagamenti successivi',
         'status':'disponibile' if present('clienti','fornitori','estrattiContoSuccessivi') and bank_ready else 'bloccato',
         'requires':['clienti','fornitori','estrattiContoSuccessivi'],
         'automaticChecks':['matching movimenti','storni e insoluti','passività non registrate','cut-off']},
        {'id':'altre_aree', 'order':6, 'title':'Verifiche per le altre aree',
         'status':'disponibile' if present('partitarioGenerale','notaIntegrativa') else 'bloccato',
         'requires':['partitarioGenerale','notaIntegrativa'],
         'automaticChecks':['immobilizzazioni','rimanenze','personale','imposte','patrimonio netto']},
        {'id':'completamento', 'order':7, 'title':'Completamento e conclusioni', 'status':'bloccato',
         'automaticChecks':['errori rilevati','eventi successivi','continuità','attestazioni','relazione']},
    ]
    required = ['bilancioXbrl','bilancioAnalitico','notaIntegrativa','clienti','fornitori','partitarioGenerale','estrattiContoSuccessivi','durc']
    missing = [key for key in required if not roles[key]]
    return {'version':'standard-client-package-1.0', 'engagementYear':engagement_year,
            'documents':roles, 'missingRoles':missing, 'stages':stages,
            'requiresHumanConfirmation':True}

def main():
    target = safe_folder(sys.argv[1] if len(sys.argv) > 1 else '')
    files = sorted((p for p in target.rglob('*') if p.is_file()), key=lambda p: str(p).lower())
    pdfs = [p for p in files if p.suffix.lower() == '.pdf']
    identity = sorted(pdfs, key=lambda p: (0 if 'visura' in p.name.lower() else 1, len(p.parts)))[0] if pdfs else None
    if not identity or 'visura' not in identity.name.lower():
        raise FileNotFoundError('Nessuna visura PDF trovata nella cartella o nelle sottocartelle')
    reader = PdfReader(str(identity))
    pages = [(page.extract_text() or '') for page in reader.pages]
    text = '\n'.join(pages[:4])
    if len(text.strip()) < 100: raise ValueError('La visura è scansionata e richiede OCR')
    vat = first_match([r'Partita\s+IVA\s*[:\-]?\s*(\d{11})'], text)
    tax = first_match([
        r'Codice\s+fiscale(?:\s+e\s+(?:n\.?\s*iscr\.?|numero\s+di\s+iscrizione))?\s*[:\-]?\s*([A-Z0-9]{11,16})'
    ], text)
    name = company_name(text, target.name)
    municipality = first_match([r'(?:Sede\s+legale|Sede)\s*[:\-]?\s*(?:\d{5}\s+)?([A-ZÀ-Ý][A-ZÀ-Ý \'-]{2,60})\s*\(([A-Z]{2})\)'], text)
    province_match = re.search(r'(?:Sede\s+legale|Sede).*?\(([A-Z]{2})\)', text, re.I | re.S)
    ateco = first_match([r'(?:Codice|Classificazione)\s+ATECO(?:RI)?[^\d]{0,30}(\d{2}(?:\.\d{1,2}){1,2})'], '\n'.join(pages))
    years = sorted({int(y) for p in files for y in re.findall(r'(?<!\d)(20\d{2})(?!\d)', str(p.relative_to(target)))}, reverse=True)
    lower_names = [p.name.lower() for p in files]
    categories = {
        'visure': sum('visura' in n for n in lower_names),
        'attiStatuti': sum(bool(re.search(r'atto.?costitutivo|statuto', n)) for n in lower_names),
        'nomine': sum(bool(re.search(r'nomina|revisor', n)) for n in lower_names),
        'bilanci': sum(bool(re.search(r'bilancio|xbrl', n)) for n in lower_names),
        'partitari': sum(bool(re.search(r'partitari?|clienti|fornitori', n)) for n in lower_names),
        'banche': sum(bool(re.search(r'estratt[oi].?conto|\bec\b|banc', n)) for n in lower_names),
    }
    engagement_year = int(sys.argv[2]) if len(sys.argv) > 2 and str(sys.argv[2]).isdigit() else (max(years) if years else datetime.now().year)
    print(json.dumps({
        'folder': 'Revisioni/' + target.relative_to(ROOT).as_posix(),
        'profile': {'ragioneSociale': name, 'codiceFiscale': tax, 'partitaIva': vat, 'formaGiuridica': legal_form(name), 'settore': ateco, 'comune': municipality, 'provincia': province_match.group(1).upper() if province_match else None},
        'years': years, 'categories': categories, 'totalFiles': len(files),
        'identitySource': identity.name, 'parser': 'dossier-clienti/visure-parser-local-1.0',
        'auditPackage': audit_package(files, engagement_year),
        'standardPackage': standard_document_package(files, engagement_year),
        'sources': [{'path': p.relative_to(ROOT).as_posix(), 'name': p.name} for p in files],
    }, ensure_ascii=False))

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print(json.dumps({'error': f'{type(exc).__name__}: {exc}'}, ensure_ascii=False))
        sys.exit(1)
