"""Read only the selected client's linked documents; never infer missing address fields."""
import json
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

sys.path.insert(0, '/var/www/html/studio-apps/document-worker/vendor')


def clean(value):
    return re.sub(r'\s+', ' ', value or '').strip(' ,;-')


def visura_address(text):
    # Anchored to the entity's cover-page address, never officers' or shareholders' addresses.
    match = re.search(r'Indirizzo\s+Sede(?:\s+legale)?\s+(.{2,120}?)\s*\(([A-Z]{2})\)\s+(.{3,220}?)\s+CAP\s+(\d{5})\b', text, re.I | re.S)
    if not match:
        return None
    city, province, street, zip_code = match.groups()
    if re.search(r'PEC|fiscale|REA|domicilio', city + street, re.I):
        return None
    return dict(address=clean(street), city=clean(city), province=province.upper(), zip=zip_code)


def xbrl_address(text):
    match = re.fullmatch(r'(.+?)\s*(?:-\s*)?(\d{5})\s+(.+?)\s*\(([A-Z]{2})\)', clean(text), re.I)
    if not match:
        return None
    street, zip_code, city, province = match.groups()
    return dict(address=clean(street), city=clean(city), province=province.upper(), zip=zip_code)


def resolve(client, archive):
    from pypdf import PdfReader
    archive = archive.resolve()
    ids = {re.sub(r'\s+', '', str(client.get('identity', {}).get(k) or '')).upper() for k in ('taxCode', 'vatNumber')} - {''}
    source_dates = {s['documentSourceId']: s.get('visuraDate') for s in client.get('sources', []) if s.get('documentSourceId')}
    docs = [d for d in client.get('documentCatalog', []) if d.get('kind') in ('visura', 'bilancio_xbrl')]
    def date_key(d):
        v = source_dates.get(d.get('documentSourceId')) if d.get('kind') == 'visura' else None
        return v or (str(d.get('year')) + '-12-31' if d.get('year') else '')
    docs.sort(key=lambda d: (date_key(d), d.get('kind') == 'visura'), reverse=True)
    candidates = []
    for doc in docs[:12]:
        path = (archive / doc.get('sourcePath', '')).resolve()
        if not path.is_relative_to(archive) or not path.is_file() or path.stat().st_size > 40_000_000:
            continue
        try:
            address = None
            if doc['kind'] == 'visura' and path.suffix.lower() == '.pdf':
                reader = PdfReader(path)
                text = '\n'.join(p.extract_text() or '' for p in reader.pages[:2])
                if not any(re.search(r'(?<![A-Z0-9])' + re.escape(i) + r'(?![A-Z0-9])', text.upper()) for i in ids):
                    continue
                address = visura_address(text)
            elif doc['kind'] == 'bilancio_xbrl' and path.suffix.lower() == '.xbrl':
                xml = path.read_bytes()
                if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
                    continue
                nodes = list(ET.fromstring(xml).iter())
                fiscal = {clean(e.text).upper() for e in nodes if e.tag.split('}')[-1] in ('DatiAnagraficiCodiceFiscale', 'DatiAnagraficiPartitaIva', 'DatiAnagraficiPartitaIVA')}
                if not ids.intersection(fiscal):
                    continue
                seats = {clean(e.text) for e in nodes if e.tag.split('}')[-1] == 'DatiAnagraficiSede'}
                if len(seats) == 1:
                    address = xbrl_address(seats.pop())
            if address:
                candidates.append(dict(address, source={'documentSourceId': doc['documentSourceId'], 'displayName': doc.get('displayName', ''), 'kind': doc['kind'], 'date': date_key(doc)}))
        except Exception:
            continue  # An unreadable document is not evidence of an address.
    if not candidates:
        return {'status': 'missing', 'message': 'Indirizzo completo non recuperabile dalle visure o dai bilanci XBRL collegati. Compilare i campi mancanti.'}
    newest = candidates[0]['source']['date']
    latest = [c for c in candidates if c['source']['date'] == newest]
    if len({tuple(c[k].upper() for k in ('address', 'zip', 'city', 'province')) for c in latest}) > 1:
        return {'status': 'conflict', 'message': 'I documenti più recenti riportano indirizzi diversi: verificare nel Dossier prima di compilare.'}
    # Do not silently use an older document if a newer linked source was unreadable.
    if docs and date_key(docs[0]) > newest:
        return {'status': 'missing', 'message': 'Un documento più recente non consente di estrarre un indirizzo completo. Verificare nel Dossier.'}
    return {'status': 'found', **latest[0], 'message': 'Indirizzo recuperato dal documento collegato: verificarne l’attualità prima del salvataggio.'}


def main():
    data = Path(sys.argv[1]).resolve()
    client_id = sys.argv[2]
    index = json.loads((data / 'admin/files/Studio/DossierClienti/private/dossier-index.json').read_text())
    client = next((c for c in index['clients'] if c['clientId'] == client_id), None)
    if not client:
        raise ValueError('Cliente non trovato')
    print(json.dumps(resolve(client, data / 'admin/files/studio-example/archivio studio-example'), ensure_ascii=False))


if __name__ == '__main__':
    main()
