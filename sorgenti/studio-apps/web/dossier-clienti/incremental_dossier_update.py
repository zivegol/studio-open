#!/usr/bin/env python3
import json
import ast
import inspect
import os
import re
import sys
import time
from pathlib import Path

APP_DIR = Path('/var/www/html/studio-apps/dossier-clienti')
DOCUMENT_WORKER_VENDOR = Path('/var/www/html/studio-apps/document-worker/vendor')
sys.path.insert(0, str(APP_DIR))
if DOCUMENT_WORKER_VENDOR.is_dir():
    sys.path.insert(0, str(DOCUMENT_WORKER_VENDOR))
import build_client_dossiers as builder

QUEUE = builder.PRIVATE_DIR / 'incremental-document-queue.jsonl'
PROCESSING = builder.PRIVATE_DIR / 'incremental-document-processing.jsonl'
STATE = builder.PRIVATE_DIR / 'incremental-document-state.json'
REVIEW = builder.PRIVATE_DIR / 'incremental-document-review.jsonl'
SCAN_STATE = builder.PRIVATE_DIR / 'incremental-document-scan-state.json'
LOCK = Path('/tmp/dossier-incremental-worker.lock')
SUPPORTED = {'.pdf', '.xlsx', '.xls', '.xml', '.xbrl', '.jpg', '.jpeg', '.png'}
_XBRL_FIELDS = None


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return fallback


def append_jsonl(path, item):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as handle:
        handle.write(json.dumps(item, ensure_ascii=False) + '\n')


def archive_relative(event_path):
    marker = '/admin/files/studio-example/archivio studio-example/'
    normalized = '/' + str(event_path or '').lstrip('/')
    if marker not in normalized:
        return None
    relative = normalized.split(marker, 1)[1]
    if not relative or '..' in Path(relative).parts:
        return None
    return relative


def match_client(relative, index, adapter, path=None):
    identifiers = set(adapter.extract_identifiers(relative))
    if not identifiers and path is not None and path.suffix.lower() == '.pdf':
        try:
            from pypdf import PdfReader
            reader = PdfReader(str(path))
            first_pages = '\n'.join((page.extract_text() or '') for page in list(reader.pages)[:3])
            identifiers.update(adapter.extract_identifiers(first_pages))
        except Exception:
            pass
    if identifiers:
        matches = [client for client in index['clients'] if identifiers.intersection({client.get('identity', {}).get('taxCode'), client.get('identity', {}).get('vatNumber')})]
        if len(matches) == 1:
            return matches[0], 'tax_id_in_path'
    parts = Path(relative).parts[:-1]
    component_keys = {adapter.norm_name(part) for part in parts}
    matches = [client for client in index['clients'] if adapter.norm_name(client.get('identity', {}).get('displayName')) in component_keys]
    if len(matches) == 1:
        return matches[0], 'exact_client_folder'
    # Client folders frequently use a shorter trading name than the registry.
    # Accept a fuzzy folder association only when one candidate is clearly
    # unique and shares at least three significant name tokens.
    stop_words = {'DI', 'DE', 'DEL', 'DELLA', 'E', 'IL', 'LA', 'LE', 'SAS', 'SNC', 'SRL', 'SPA'}
    component_tokens = []
    for part in parts:
        tokens = {token for token in adapter.norm_name(part).upper().split() if len(token) > 1 and token not in stop_words}
        if tokens:
            component_tokens.append(tokens)
    scored = []
    for client in index['clients']:
        client_tokens = {
            token for token in adapter.norm_name(client.get('identity', {}).get('displayName')).upper().split()
            if len(token) > 1 and token not in stop_words
        }
        overlap = max((len(client_tokens.intersection(tokens)) for tokens in component_tokens), default=0)
        if overlap >= 3:
            scored.append((overlap, client))
    if scored:
        best_score = max(score for score, _client in scored)
        best = [client for score, client in scored if score == best_score]
        if len(best) == 1:
            return best[0], 'unique_client_folder_tokens'
    filename_key = adapter.norm_name(Path(relative).stem)
    matches = []
    for client in index['clients']:
        key = adapter.norm_name(client.get('identity', {}).get('displayName'))
        if len(key) >= 6 and (filename_key == key or filename_key.startswith(key + ' ')):
            matches.append(client)
    if len(matches) == 1:
        return matches[0], 'unique_filename_name'
    return None, 'ambiguous' if len(matches) > 1 else 'unmatched'


def classify(path):
    kind = builder.classify_studio_document(path)
    upper = path.as_posix().upper()
    if path.suffix.lower() == '.xbrl':
        kind = 'bilancio_xbrl'
    elif not kind and 'VISUR' in upper and path.suffix.lower() == '.pdf':
        kind = 'visura'
    elif not kind and "DOCUMENTI D'IDENTIT" in upper:
        kind = 'documento_identita'
    elif not kind and '/BILANCI/' in upper:
        kind = 'bilancio_analitico' if path.suffix.lower() in {'.xlsx', '.xls'} else 'situazione_contabile'
    return kind or 'documento_generico'


def discover_recent_events(scan_started_ns):
    """Find only files created/changed since the prior successful run.

    The directory walk reads filesystem metadata only; document contents are
    parsed later and only for the paths whose ctime is newer than the stored
    watermark. Nextcloud events remain the primary source of work.
    """
    previous = load_json(SCAN_STATE, {}).get('completedCtimeNs')
    if not isinstance(previous, int):
        return []
    events = []
    for path in builder.ARCHIVE_ROOT.rglob('*'):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED:
            continue
        try:
            changed_ns = path.stat().st_ctime_ns
        except OSError:
            continue
        if previous < changed_ns <= scan_started_ns:
            relative = path.relative_to(builder.ARCHIVE_ROOT).as_posix()
            events.append({'path': '/admin/files/studio-example/archivio studio-example/' + relative,
                           'event': 'filesystem_ctime_fallback', 'time': int(time.time())})
    return events


def extract_xbrl(path, document):
    global _XBRL_FIELDS
    if _XBRL_FIELDS is None:
        tree = ast.parse(inspect.getsource(builder.scan_xbrl_balances))
        assignment = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'fields' for target in node.targets))
        _XBRL_FIELDS = ast.literal_eval(assignment.value)
    root = builder.ET.parse(path).getroot()
    contexts = {}
    for node in root.iter():
        if node.tag.rsplit('}', 1)[-1] != 'context':
            continue
        context_id = node.attrib.get('id')
        dates = [child.text for child in node.iter() if child.tag.rsplit('}', 1)[-1] in {'instant', 'endDate'} and child.text]
        if context_id and dates:
            contexts[context_id] = int(dates[-1][:4])
    records = {}
    for node in root.iter():
        field = _XBRL_FIELDS.get(node.tag.rsplit('}', 1)[-1])
        year = contexts.get(node.attrib.get('contextRef'))
        if not field or not year or node.text is None:
            continue
        try:
            records.setdefault(year, {})[field] = float(node.text.strip())
        except ValueError:
            continue
    source = {'documentSourceId': document['documentSourceId'], 'kind': 'bilancio_xbrl', 'displayName': document['displayName'], 'sourcePath': document['sourcePath']}
    return [dict(values, year=year, quality='verified_xbrl', source=source) for year, values in sorted(records.items())]


def process_one(event, index, state, adapter):
    relative = archive_relative(event.get('path'))
    if not relative:
        return 'ignored'
    path = builder.ARCHIVE_ROOT / relative
    if not path.is_file() or path.suffix.lower() not in SUPPORTED:
        return 'ignored'
    stat = path.stat()
    signature = f'{stat.st_size}:{stat.st_mtime_ns}:incremental-4'
    if state.get(relative) == signature:
        return 'unchanged'
    if time.time() - stat.st_mtime < 3:
        append_jsonl(QUEUE, event)
        return 'deferred'
    client, method = match_client(relative, index, adapter, path)
    if client is None:
        append_jsonl(REVIEW, {'time': int(time.time()), 'path': relative, 'reason': method})
        return method
    kind = classify(path)
    year = builder.document_year(path)
    if kind in {'redditi_sc', 'redditi_sp', 'redditi_pf', 'irap', 'iva'} and year:
        year -= 1
    if kind == 'bilancio_xbrl':
        document_seed = 'xbrl:' + relative
    elif kind == 'visura':
        visura_relative = relative.split('VISURE/', 1)[1] if relative.startswith('VISURE/') else relative
        document_seed = 'visura:' + visura_relative
    else:
        document_seed = 'studio-document:' + relative
    document_id = builder.opaque_id('doc', document_seed)
    document = {
        'documentSourceId': document_id, 'kind': kind, 'year': year,
        'displayName': builder.safe_display_name(path.name), 'fileSize': stat.st_size,
        'status': 'available', 'dataStatus': 'pending_extraction' if kind == 'bilancio_xbrl' else 'document_only',
        'associationMethod': method, 'sourcePath': relative,
    }
    catalog = client.setdefault('documentCatalog', [])
    catalog[:] = [item for item in catalog if item.get('documentSourceId') != document_id]
    catalog.append(document)
    if kind in {'bilancio_cee', 'situazione_contabile'}:
        records = builder.extract_pdf_financials([document])
        for record in records:
            record_year = int(record.get('year') or 0)
            if not record_year or record.get('quality') == 'error':
                continue
            existing = [item for item in client.setdefault('bilanci', []) if int(item.get('year') or 0) == record_year]
            if existing and any(item.get('quality') == 'verified_xbrl' for item in existing):
                continue
            client['bilanci'] = [item for item in client['bilanci'] if int(item.get('year') or 0) != record_year]
            client['bilanci'].append(record)
        client['bilanci'].sort(key=lambda item: int(item.get('year') or 0))
    elif kind == 'bilancio_xbrl':
        records = extract_xbrl(path, document)
        for record in records:
            record_year = int(record.get('year') or 0)
            client['bilanci'] = [item for item in client.setdefault('bilanci', []) if int(item.get('year') or 0) != record_year]
            client['bilanci'].append(record)
        client['bilanci'].sort(key=lambda item: int(item.get('year') or 0))
        document['year'] = max((item.get('year') for item in records), default=year)
        document['dataStatus'] = 'extracted'
    elif kind == 'visura':
        try:
            from pypdf import PdfReader
            pages = [(page.extract_text() or '') for page in PdfReader(str(path)).pages]
            governance = builder.extract_governance(pages)
            identity = builder.extract_visura_identity(pages, adapter)
            visura_date = builder.parse_visura_date('\n'.join(pages[:3]))
            source = {'documentSourceId': document_id, 'kind': 'visura', 'page': 1, 'parserVersion': 'visure-parser-3.0'}
            facts = client.setdefault('facts', {})
            if identity.get('legalName'):
                client.setdefault('identity', {})['displayName'] = identity['legalName']
                facts['denominazione'] = {'value': identity['legalName'], 'status': 'candidate', 'confidence': 0.98, 'source': source}
            if identity.get('legalForm'):
                facts['formaGiuridica'] = {'value': identity['legalForm'], 'status': 'candidate', 'confidence': 0.98, 'source': source}
            if identity.get('taxCode'):
                client.setdefault('identity', {})['taxCode'] = identity['taxCode']
            if identity.get('vatNumber'):
                client.setdefault('identity', {})['vatNumber'] = identity['vatNumber']
            representatives = governance.get('representatives') or []
            if representatives:
                representative = representatives[0]
                facts['legaleRappresentante'] = {'value': representative['name'], 'status': 'candidate', 'confidence': 0.95, 'role': representative.get('role'), 'source': source | {'page': representative.get('page') or 1}}
            facts['amministratori'] = {'value': governance.get('administrators') or [], 'status': 'candidate' if governance.get('administrators') else 'missing', 'confidence': 0.9 if governance.get('administrators') else None, 'source': source}
            facts['compagineSociale'] = {'value': governance.get('shareholders') or [], 'status': 'candidate' if governance.get('shareholders') else 'missing', 'confidence': 0.9 if governance.get('shareholders') else None, 'source': source}
            if governance.get('system'):
                facts['sistemaAmministrazione'] = {'value': governance['system'], 'status': 'candidate', 'confidence': 0.9, 'source': source | {'page': governance.get('systemPage') or 1}}
            if visura_date:
                facts['dataUltimaVisura'] = {'value': visura_date, 'status': 'candidate', 'confidence': 0.95, 'source': source}
                document['year'] = int(visura_date[:4])
            document['dataStatus'] = 'extracted'
            sources = client.setdefault('sources', [])
            sources[:] = [item for item in sources if item.get('documentSourceId') != document_id]
            sources.append({'documentSourceId': document_id, 'kind': 'visura', 'status': 'available', 'displayName': document['displayName'], 'identityPage': 1, 'visuraDate': visura_date})
        except Exception as exc:
            document['dataStatus'] = 'review_required'
            document['errorCode'] = type(exc).__name__
    summaries = []
    if kind == 'redditi_pf':
        summaries = builder.extract_historical_pf_summaries([document])
    elif kind in {'redditi_sc', 'redditi_sp'}:
        summaries = builder.extract_historical_business_summaries([document])
    elif kind in {'irap', 'iva'}:
        summaries = builder.extract_historical_indirect_tax_summaries([document])
    if summaries:
        current_summaries = client.setdefault('taxSummaries', [])
        for summary in summaries:
            identity = (summary.get('tax'), summary.get('taxYear'))
            current_summaries[:] = [item for item in current_summaries if (item.get('tax'), item.get('taxYear')) != identity]
            current_summaries.append(summary)
        document['dataStatus'] = 'extracted'
    expected = sorted({int(item['year']) for item in catalog if item.get('kind') in {'bilancio_cee', 'situazione_contabile', 'bilancio_analitico'} and item.get('year')})
    parsed = sorted({int(item['year']) for item in client.get('bilanci', []) if item.get('year')})
    audit = client.setdefault('coverageAudit', {})
    audit['missingBalanceYears'] = [value for value in expected if value not in parsed]
    audit['balanceYearsAvailable'] = parsed
    audit['status'] = 'complete' if not audit.get('missingBalanceYears') and not audit.get('missingTaxSummaries') else 'incomplete'
    state[relative] = signature
    return f'updated:{kind}'


def main():
    try:
        LOCK.mkdir()
    except FileExistsError:
        return 0
    try:
        scan_started_ns = time.time_ns()
        if not PROCESSING.exists() or PROCESSING.stat().st_size == 0:
            if QUEUE.exists() and QUEUE.stat().st_size:
                try:
                    os.replace(QUEUE, PROCESSING)
                except FileNotFoundError:
                    pass
        events = []
        processing_text = PROCESSING.read_text(encoding='utf-8') if PROCESSING.exists() else ''
        for line in processing_text.splitlines():
            try:
                item = json.loads(line)
                if isinstance(item, dict):
                    events.append(item)
            except Exception:
                continue
        events.extend(discover_recent_events(scan_started_ns))
        latest = {item.get('path'): item for item in events if item.get('path')}
        if not latest:
            scan_temp = SCAN_STATE.with_suffix('.tmp')
            scan_temp.write_text(json.dumps({'completedCtimeNs': scan_started_ns}, indent=2), encoding='utf-8')
            scan_temp.replace(SCAN_STATE)
            PROCESSING.unlink(missing_ok=True)
            return 0
        index = load_json(builder.OUTPUT, {'clients': []})
        state = load_json(STATE, {})
        adapter, _registry = builder.load_registry_adapter()
        counts = {}
        for event in latest.values():
            try:
                outcome = process_one(event, index, state, adapter)
            except Exception as exc:
                outcome = 'error:' + type(exc).__name__
                append_jsonl(REVIEW, {'time': int(time.time()), 'path': event.get('path'),
                                      'reason': outcome, 'message': str(exc)[:300]})
            counts[outcome] = counts.get(outcome, 0) + 1
        temp = builder.OUTPUT.with_suffix('.incremental.tmp')
        index['generatedAt'] = builder.dt.datetime.now(builder.dt.timezone.utc).isoformat()
        temp.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding='utf-8')
        temp.replace(builder.OUTPUT)
        builder.write_client_list(index)
        state_temp = STATE.with_suffix('.tmp')
        state_temp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding='utf-8')
        state_temp.replace(STATE)
        scan_temp = SCAN_STATE.with_suffix('.tmp')
        scan_temp.write_text(json.dumps({'completedCtimeNs': scan_started_ns}, indent=2), encoding='utf-8')
        scan_temp.replace(SCAN_STATE)
        PROCESSING.unlink(missing_ok=True)
        print(json.dumps({'events': len(latest), 'outcomes': counts}))
        return 0
    finally:
        try:
            LOCK.rmdir()
        except OSError:
            pass


if __name__ == '__main__':
    raise SystemExit(main())
