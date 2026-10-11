import base64
import hashlib
import hmac
import json
import os
import re
import sqlite3
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4
from domain import blank, check, paragraphs
from extract import read_document, parse
from documents import word, pdfa

ROOT = Path(os.environ.get('CESSIONI_DATA', '/data'))
NCDATA = Path(os.environ.get('NCDATA', '/ncdata'))
LOCK = threading.Lock()


def db():
    ROOT.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(ROOT / 'cessioni.sqlite', timeout=20)
    conn.row_factory = sqlite3.Row
    conn.executescript('''CREATE TABLE IF NOT EXISTS acts(id TEXT PRIMARY KEY, uid TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL, docx BLOB, pdf BLOB, report TEXT, hash TEXT);
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT, hash TEXT, content BLOB, text TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, act TEXT, uid TEXT, revision INTEGER, data TEXT, created TEXT);''')
    return conn


def now(): return datetime.now(timezone.utc).isoformat()


def load(conn, uid, ident):
    row = conn.execute('SELECT * FROM acts WHERE id=? AND uid=?', (ident, uid)).fetchone()
    if not row: raise ValueError('Pratica non trovata')
    return row


def public(row):
    return {'id': row['id'], 'revision': row['revision'], 'status': row['status'], 'data': json.loads(row['data']), 'updated': row['updated'], 'hash': row['hash']}


def source(conn, uid, name, content):
    if len(content) > 20_000_000: raise ValueError('Allegato oltre 20 MB')
    suffix = Path(name).suffix.lower()
    if suffix not in ['.pdf', '.png', '.jpg', '.jpeg']: raise ValueError('Formato non supportato')
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / ('source'+suffix)
        path.write_bytes(content)
        text, ocr = read_document(path)
    if not text.strip(): raise ValueError('Documento non leggibile; provare una scansione più nitida')
    ident, digest = uuid4().hex, hashlib.sha256(content).hexdigest()
    conn.execute('INSERT INTO sources VALUES (?,?,?,?,?,?,?)', (ident, uid, name[:200], digest, content, text, now()))
    conn.commit()
    return {'source': {'id': ident, 'name': name[:200], 'hash': digest, 'ocr': ocr}, 'extracted': parse(text), 'text': text}


def dossier_index():
    return json.loads((NCDATA / 'admin/files/Studio/DossierClienti/private/dossier-index.json').read_text())


def dispatch(uid, op, body):
    with db() as conn:
        if op == 'list':
            return {'acts': [public(r) for r in conn.execute('SELECT * FROM acts WHERE uid=? ORDER BY updated DESC', (uid,))]}
        if op == 'dossier':
            clients = dossier_index().get('clients', [])
            if not body.get('clientId'):
                return {'clients': [{'id': c['clientId'], 'name': c['identity'].get('displayName', '')} for c in clients]}
            client = next((c for c in clients if c['clientId'] == body['clientId']), None)
            if not client: raise ValueError('Dossier non trovato')
            return {'documents': [{'id': d['documentSourceId'], 'name': d.get('displayName', d['documentSourceId']), 'year': d.get('year')} for d in client.get('documentCatalog', []) if d.get('kind') == 'visura'], 'identity': client.get('identity', {})}
        if op == 'dossier_import':
            client = next((c for c in dossier_index().get('clients', []) if c['clientId'] == body.get('clientId')), None)
            if not client: raise ValueError('Dossier non trovato')
            doc = next((d for d in client.get('documentCatalog', []) if d.get('kind') == 'visura' and d.get('documentSourceId') == body.get('documentId')), None)
            if not doc: raise ValueError('Visura non associata al cliente')
            archive = (NCDATA / 'admin/files/studio-example/archivio studio-example').resolve()
            path = (archive / doc['sourcePath']).resolve()
            if not path.is_relative_to(archive) or not path.is_file() or path.stat().st_size > 20_000_000: raise ValueError('Fonte non accessibile')
            result = source(conn, uid, path.name, path.read_bytes())
            fiscal = {str(client.get('identity', {}).get(k) or '').upper() for k in ('taxCode', 'vatNumber')} - {''}
            if not fiscal or result['extracted']['company']['taxCode'].upper() not in fiscal:
                raise ValueError('Il codice fiscale della visura non coincide con quello del Dossier')
            result['source']['clientId'] = client['clientId']
            return result
        if op == 'upload':
            return source(conn, uid, str(body.get('name', '')), base64.b64decode(body.get('content', ''), validate=True))
        if op == 'preview':
            return {'validation': check(body['data']), 'paragraphs': paragraphs(body['data'])}
        if op == 'save':
            data = body['data']
            if not isinstance(data, dict): raise ValueError('Dati non validi')
            if len(json.dumps(data)) > 500000: raise ValueError('Pratica troppo grande')
            ident = body.get('id') or uuid4().hex
            conn.execute('BEGIN IMMEDIATE')
            old = conn.execute('SELECT * FROM acts WHERE id=? AND uid=?', (ident, uid)).fetchone()
            if old and (old['status'] != 'draft' or old['revision'] != body.get('revision')):
                raise ValueError('Pratica definitiva o modificata da un’altra sessione. Ricaricare dall’archivio.')
            if body.get('id') and not old: raise ValueError('Pratica non trovata')
            rev = old['revision']+1 if old else 1
            data['checks'] = {}  # Every edit requires renewed final review.
            payload = json.dumps(data, ensure_ascii=False)
            conn.execute('INSERT INTO acts(id,uid,revision,status,data,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated=excluded.updated', (ident, uid, rev, 'draft', payload, now()))
            conn.execute('INSERT INTO history(act,uid,revision,data,created) VALUES(?,?,?,?,?)', (ident, uid, rev, payload, now()))
            conn.commit()
            return public(load(conn, uid, ident))
        if op in ('word', 'pdf', 'report', 'finalize'):
            row = load(conn, uid, body.get('id'))
            data = json.loads(row['data'])
            if op == 'pdf' or op == 'report':
                if row['status'] != 'final': raise ValueError('Il PDF/A è disponibile solo per il definitivo validato')
                return {'content': base64.b64encode(row['pdf'] if op == 'pdf' else row['report'].encode()).decode(), 'filename': 'cessione-'+row['id']+('.pdf' if op == 'pdf' else '-verapdf.xml')}
            if op == 'word' and row['status'] == 'final':
                return {'content': base64.b64encode(row['docx']).decode(), 'filename': 'cessione-'+row['id']+'.docx'}
            if op == 'finalize':
                if row['status'] != 'draft' or row['revision'] != body.get('revision'): raise ValueError('Versione non più disponibile: ricaricare la pratica')
                data['checks'] = body.get('checks', {})
                validation = check(data, True)
                if validation['errors']: return {'validation': validation}
                for s in data.get('sources', []):
                    if not conn.execute('SELECT id FROM sources WHERE id=? AND uid=? AND hash=?', (s.get('id'), uid, s.get('hash'))).fetchone(): raise ValueError('Fonte non disponibile nell’archivio')
            with tempfile.TemporaryDirectory() as td:
                path = Path(td) / 'cessione.docx'
                word(data, path, op == 'finalize')
                content = path.read_bytes()
                if op == 'word': return {'content': base64.b64encode(content).decode(), 'filename': 'bozza-cessione.docx'}
                pdf, report = pdfa(path, td)
            conn.execute('BEGIN IMMEDIATE')
            current = load(conn, uid, row['id'])
            if current['revision'] != row['revision'] or current['status'] != 'draft': raise ValueError('La bozza è cambiata durante la conversione: ricaricare e riprovare')
            digest = hashlib.sha256(pdf).hexdigest()
            payload = json.dumps(data, ensure_ascii=False)
            conn.execute('UPDATE acts SET revision=revision+1,status=?,data=?,updated=?,docx=?,pdf=?,report=?,hash=? WHERE id=? AND uid=?', ('final', payload, now(), content, pdf, report, digest, row['id'], uid))
            conn.execute('INSERT INTO history(act,uid,revision,data,created) VALUES(?,?,?,?,?)', (row['id'], uid, row['revision']+1, payload, now()))
            conn.commit()
            return public(load(conn, uid, row['id']))
        raise ValueError('Operazione non supportata')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass  # No identities, document bodies or tokens in logs.
    def do_POST(self):
        try:
            token = (NCDATA / 'studio-cessioni/service.key').read_text().strip()
            if not token or not hmac.compare_digest(self.headers.get('X-Service-Key', ''), token):
                self.send_error(403); return
            uid = self.headers.get('X-Studio-User', '')
            if not uid or len(uid) > 100: raise ValueError('Utente mancante')
            size = int(self.headers.get('Content-Length', '0'))
            if size < 2 or size > 28_000_000: raise ValueError('Richiesta oltre il limite')
            body = json.loads(self.rfile.read(size))
            with LOCK:
                result = dispatch(uid, self.path.strip('/'), body)
            output = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(200)
        except ValueError as e:
            output = json.dumps({'error': str(e)}).encode(); self.send_response(422)
        except Exception as e:
            print(type(e).__name__, flush=True)
            output = json.dumps({'error': 'Operazione non completata. Controllare il documento e la disponibilità del servizio.'}).encode(); self.send_response(500)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(output)))
        self.end_headers(); self.wfile.write(output)


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8096), Handler).serve_forever()
