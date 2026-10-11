"""Deterministic IT/EN registry extraction and local OCR. Text is data, never instructions."""
import re
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4
from pypdf import PdfReader


def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip(' :;')


def first(pattern, text, flags=re.I):
    m = re.search(pattern, text, flags)
    return clean(m.group(1)) if m else ''


def read_document(path):
    path = Path(path)
    ocr = False
    if path.suffix.lower() == '.pdf':
        reader = PdfReader(path)
        if len(reader.pages) > 40: raise ValueError('Massimo 40 pagine per documento')
        pages = []
        with tempfile.TemporaryDirectory() as td:
            for i, page in enumerate(reader.pages):
                text = page.extract_text() or ''
                if len(text.strip()) < 40:
                    ocr = True
                    prefix = str(Path(td) / f'p{i}')
                    subprocess.run(['pdftoppm', '-f', str(i+1), '-l', str(i+1), '-scale-to', '2400', '-png', '-singlefile', str(path), prefix], check=True, capture_output=True, timeout=30)
                    text = subprocess.run(['tesseract', prefix+'.png', 'stdout', '-l', 'ita+eng'], check=True, capture_output=True, text=True, timeout=45).stdout
                pages.append(text)
        return '\n'.join(pages)[:250000], ocr
    if path.suffix.lower() not in ('.png', '.jpg', '.jpeg'):
        raise ValueError('Allegare PDF, PNG o JPEG')
    return subprocess.run(['tesseract', str(path), 'stdout', '-l', 'ita+eng'], check=True, capture_output=True, text=True, timeout=60).stdout[:250000], True


def parse(text):
    report_date = first(r'Document protocol no\.[^\n]*?Date\s+(\d{2}/\d{2}/\d{4})', text) or first(r'(?:estratto.*?data|Data estrazione)\s*:?\s*(\d{2}/\d{2}/\d{4})', text)
    # Remove repeated page furniture before matching records that cross page boundaries.
    text = re.sub(r'Official Business Register of the Italian Chambers of Commerce and Industry.*?Company Registration Report[^\n]*(?:\n\d+\s*\n\d+)?', '', text, flags=re.S)
    c = {'name': first(r'(?:Company name|Denominazione)\s+([^\n]+)', text),
         'taxCode': first(r'(?:Fiscal code(?: and registration\s+number)?|Codice fiscale(?: e numero[^\n]*)?)\s*:?\s*(\d{11})', text),
         'address': first(r'(?:Registered address|Indirizzo Sede(?: legale)?)\s+(.+?CAP\s+\d{5})', text, re.I|re.S),
         'rea': first(r'(?:REA number(?:\s*\([^)]*\))?|Numero REA)\s*([A-Z]{2}\s*[-–]\s*\d+)', text),
         'register': first(r'(?:Business Register of|Registro Imprese di)\s+([^\n]+)', text),
         'capital': first(r'(?:Subscribed|Sottoscritto)\s*:?\s*([\d.,]+)', text) or first(r'Share capital\s+([\d.,]+)', text),
         'paidCapital': first(r'(?:Paid-up|Versato)\s*:?\s*([\d.,]+)', text),
         'reportDate': report_date}
    if not c['name']:
        c['name'] = first(r'(?:DATI ANAGRAFICI\s*\n)?^\s*([^\n]+S\.?R\.?L\.?(?:\s*SEMPLIFICATA)?)\s*$', text, re.M|re.I)
    parties = []
    if 'Nominal shares:' in text:
        blocks = re.split(r'Nominal shares:', text)[1:]
        for block in blocks:
            name = first(r'Rights Holder:\s*(.*?)\s*Fiscal code:', block, re.S|re.I)
            code = first(r'Rights Holder:.*?Fiscal code:\s*([A-Z0-9]{11,16})', block, re.S|re.I)
            if not name or not code: continue
            parties.append({'id': uuid4().hex, 'name': name, 'taxCode': code, 'kind': 'company' if len(code) == 11 else 'person',
                            'holding': first(r'^\s*([\d.,]+)', block), 'address': first(r'Address of shareholder or joint representative:\s*(.*?CAP\s*\d{5})', block, re.S|re.I),
                            'right': first(r'Type of rights:\s*([^\n]+)', block)})
    else:
        # Ordinary Italian registry layout: nominal block followed by holder and fiscal code.
        for block in re.split(r'Quota di nominali:', text, flags=re.I)[1:]:
            code = first(r'Codice fiscale:\s*([A-Z0-9]{11,16})', block)
            name = first(r'Euro\s*\n\s*(.*?)\s*\n\s*Codice fiscale:', block, re.S|re.I)
            if not code or not name or len(name) > 180: continue
            parties.append({'id': uuid4().hex, 'name': name, 'taxCode': code, 'kind': 'company' if len(code) == 11 else 'person',
                            'holding': first(r'^\s*([\d.,]+)', block), 'address': first(r'(?:Domicilio|Sede)(?: del titolare[^\n]*)?\s*\n\s*(.*?CAP\s*\d{5})', block, re.S|re.I),
                            'right': first(r'Tipo di diritto:\s*([^\n]+)', block)})
    # Never combine the first shareholder's CF with an officer's birth data.
    if c['taxCode'] and (parties or 'Company identification' in text or 'DATI ANAGRAFICI' in text):
        officials = re.split(r'(?:Governing directors|Amministratori)', text)
        text = officials[-1] if len(officials) > 1 and len(re.findall(r'(?:Surname:|Data di nascita)', officials[-1])) == 1 else ''
    person = {'name': '', 'taxCode': first(r'\b([A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])\b', text),
              'birthDate': first(r'(?:Data di nascita|Date of birth)\s*:?\s*(\d{2}[/.]\d{2}[/.]\d{4})', text),
              'birthPlace': first(r'(?:Luogo di nascita|Place of birth)\s*:?\s*([^\n]+)', text),
              'address': first(r'(?:Residenza|Residence)\s*:?\s*([^\n]+)', text)}
    surname = first(r'(?:Cognome\s*/\s*Surname|Cognome|Surname)\s*:?\s*([^\n]+)', text)
    given = first(r'(?:Nome\s*/\s*Name|Nome|First name)\s*:?\s*([^\n]+)', text)
    if surname and given: person['name'] = surname + ' ' + given
    return {'company': c, 'parties': parties, 'person': person,
            'warnings': ['Verificare i dati estratti e completare quelli mancanti. Il domicilio in visura non prova la residenza attuale.',
                         'I diritti diversi dalla piena proprietà e i dati non riconosciuti richiedono una revisione del caso.']}
