#!/usr/bin/env python3
import copy
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

DATA_ROOT = Path("/var/www/html/data/admin/files")
BASE_FOLDER = DATA_ROOT / "studio-example" / "archivio studio-example"
REGISTRY_FILE = BASE_FOLDER / "adempimenti CLIENTI.xlsx"
SOURCE_DIR = BASE_FOLDER / "bilanci analitici" / "2025"
YEAR = "2025"
DEST_DIR = BASE_FOLDER / "bilanci analitici" / "EXPORT DATABASE NAZIONALE" / YEAR
PRIVATE_DIR = DATA_ROOT / "Studio" / "Bilanci" / "Private"
STATE_FILE = PRIVATE_DIR / f"anonymization-state-{YEAR}.json"
LOG_FILE = PRIVATE_DIR / f"anonymization-{YEAR}.log"
EXPORT_MANIFEST = DEST_DIR / "export-manifest.json"
PIPELINE_VERSION = "2.1-clean-workbook-gated"

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "officeRel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

CE_PATTERNS = [r"conto\s*economico", r"\bce\b", r"economico", r"ricavi", r"costi"]
SP_PATTERNS = [r"stato\s*patrimoniale", r"\bsp\b", r"patrimoniale", r"attivo", r"passivo"]
SENSITIVE_LABELS = [
    r"ragione\s*sociale", r"denominazione", r"nominativo", r"cliente",
    r"codice\s*fiscale", r"partita\s*iva", r"\bp\.?\s*iva\b",
    r"indirizzo", r"\bvia\b", r"piazza", r"pec", r"email", r"telefono",
    r"cellulare", r"legale\s*rappresentante", r"amministratore",
]


def log(message):
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(f"[{stamp}] {message}\n")
    print(message)


def load_state():
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)
    fix_file_permissions(STATE_FILE)


def norm_header(value):
    return str(value or "").strip().lower()


def norm_name(value):
    text = unicodedata.normalize("NFD", str(value or "").lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def name_tokens(value):
    stop = {"e", "c", "di", "del", "della", "snc", "sas", "srl", "spa", "societa"}
    return [t for t in norm_name(value).split() if len(t) >= 3 and t not in stop]


def normalize_identifier(value):
    s = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if re.fullmatch(r"[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]", s):
        return s
    if re.fullmatch(r"[0-9]{11}", s):
        return s
    return ""


def normalize_forma(value):
    v = norm_header(value)
    if re.search(r"s\.?\s*r\.?\s*l|srl|responsabilita limitata", v):
        return "srl"
    if re.search(r"s\.?\s*a\.?\s*s|sas", v):
        return "sas"
    if re.search(r"s\.?\s*n\.?\s*c|snc", v):
        return "snc"
    if re.search(r"ditta|individuale|impresa individuale", v):
        return "d.i."
    if "associa" in v:
        return "associazione"
    return str(value or "").strip()


def safe_name(value):
    s = re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")
    return (s or "nd")[:40]


def anon_id(seed):
    return "anon_" + hashlib.sha1(str(seed).encode("utf-8")).hexdigest()[:10]


def parse_shared_strings(zf):
    name = "xl/sharedStrings.xml"
    if name not in zf.namelist():
        return []
    root = ET.fromstring(zf.read(name))
    out = []
    for si in root.findall("main:si", NS):
        chunks = [t.text or "" for t in si.findall(".//main:t", NS)]
        out.append("".join(chunks))
    return out


def workbook_sheet_paths(zf):
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {}
    for rel in rels.findall("rel:Relationship", NS):
        rid_to_target[rel.attrib.get("Id")] = rel.attrib.get("Target", "")

    sheets = []
    for sheet in wb.findall(".//main:sheet", NS):
        rid = sheet.attrib.get(f"{{{NS['officeRel']}}}id")
        target = rid_to_target.get(rid, "")
        if not target:
            continue
        target = target.lstrip("/")
        path = target if target.startswith("xl/") else "xl/" + target
        sheets.append({"name": sheet.attrib.get("name", ""), "path": path})
    return sheets


def cell_text(cell, shared):
    value = cell.find("main:v", NS)
    inline = cell.find("main:is/main:t", NS)
    if inline is not None:
        return inline.text or ""
    if value is None or value.text is None:
        return ""
    if cell.attrib.get("t") == "s":
        try:
            return shared[int(value.text)]
        except Exception:
            return ""
    if cell.attrib.get("t") in {"str", "inlineStr"}:
        return value.text
    try:
        number = float(value.text)
        return int(number) if number.is_integer() else number
    except (TypeError, ValueError):
        return value.text


def cell_col_index(ref):
    letters = re.sub(r"[^A-Z]", "", str(ref or "").upper())
    idx = 0
    for char in letters:
        idx = idx * 26 + (ord(char) - 64)
    return max(idx - 1, 0)


def rows_from_sheet(zf, sheet_path, shared, max_rows=None):
    root = ET.fromstring(zf.read(sheet_path))
    rows = []
    for row in root.findall(".//main:sheetData/main:row", NS):
        values = []
        for cell in row.findall("main:c", NS):
            idx = cell_col_index(cell.attrib.get("r", ""))
            while len(values) <= idx:
                values.append("")
            values[idx] = cell_text(cell, shared)
        rows.append(values)
        if max_rows and len(rows) >= max_rows:
            break
    return rows


def workbook_text(path):
    chunks = [path.name]
    with zipfile.ZipFile(path) as zf:
        shared = parse_shared_strings(zf)
        for sheet in workbook_sheet_paths(zf):
            chunks.append(sheet["name"])
            for row in rows_from_sheet(zf, sheet["path"], shared, 80):
                chunks.append(" ".join(str(value) for value in row))
    return " ".join(chunks)


def extract_geo_from_text(text):
    value = re.sub(r"\s+", " ", str(text or " "))
    # Typical source row: "VIA A.MORO, 58 - 37022 Fumane (VR)"
    match = re.search(r"\b(?P<cap>\d{5})\s+(?P<comune>[A-Za-zÀ-ÖØ-öø-ÿ' .-]+?)\s*\((?P<prov>[A-Z]{2})\)", value)
    if not match:
        return {"cap": "", "comune": "", "citta": ""}
    comune = match.group("comune").strip(" -,.")
    return {
        "cap": match.group("cap"),
        "comune": comune,
        "citta": match.group("prov"),
    }


def extract_identifiers(text):
    upper = str(text or "").upper()
    ids = re.findall(r"[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]", upper)
    ids += re.findall(r"(?<![0-9])[0-9]{11}(?![0-9])", upper)
    seen = []
    for value in ids:
        norm = normalize_identifier(value)
        if norm and norm not in seen:
            seen.append(norm)
    return seen


def detect_header_row(rows):
    best_idx, best_score = 0, -1
    keys = ["ateco", "cap", "comune", "citta", "forma", "partita", "fiscale", "denominazione"]
    for idx, row in enumerate(rows[:20]):
        text = " ".join(norm_header(x) for x in row)
        score = sum(1 for key in keys if key in text)
        if score > best_score:
            best_idx, best_score = idx, score
    return best_idx


def find_col(headers, keys):
    for key in keys:
        for idx, header in enumerate(headers):
            if key in header:
                return idx
    return -1


def val(row, idx):
    return str(row[idx]).strip() if idx >= 0 and idx < len(row) else ""


def load_registry():
    if not REGISTRY_FILE.exists():
        raise FileNotFoundError(f"Anagrafica non trovata: {REGISTRY_FILE}")
    by_id = {}
    records = []
    with zipfile.ZipFile(REGISTRY_FILE) as zf:
        shared = parse_shared_strings(zf)
        sheets = workbook_sheet_paths(zf)
        sheet = next((s for s in sheets if s["name"].strip().lower() == "elenco clienti 2026"), None)
        if sheet is None:
            raise RuntimeError("Foglio 'ELENCO CLIENTI 2026' non trovato nell'anagrafica")

        rows = rows_from_sheet(zf, sheet["path"], shared)
        header = [norm_header(v) for v in rows[0]] if rows else []
        has_employee_column = len(header) > 2 and re.search(r"dipend|addett|n[. ]", header[2] or "")
        if has_employee_column:
            cols = {
                "piva": 0,
                "cf": 1,
                "dipendenti": 2,
                "name": 3,
                "forma": 4,
                "ateco": 5,
            }
        else:
            cols = {
                "piva": 0,
                "cf": 1,
                "dipendenti": -1,
                "name": 2,
                "forma": 3,
                "ateco": 4,
            }
        for row in rows[1:]:
            partita_iva = normalize_identifier(val(row, cols["piva"]))
            codice_fiscale = normalize_identifier(val(row, cols["cf"]))
            name = val(row, cols["name"])
            if not partita_iva and not codice_fiscale and not name:
                continue

            raw_forma = val(row, cols["forma"])
            forma = normalize_forma(raw_forma)
            if norm_name(raw_forma) in {"s p", "sp"}:
                forma = detect_forma(name)
            record = {
                "cap": "",
                "comune": "",
                "citta": "",
                "ateco": val(row, cols["ateco"]),
                "forma": forma,
                "name": name,
                "dipendenti": val(row, cols["dipendenti"]),
                "identifiers": [x for x in (partita_iva, codice_fiscale) if x],
            }
            record["name_key"] = norm_name(record["name"])
            record["name_tokens"] = name_tokens(record["name"])
            if record["name_key"]:
                records.append(record)
            if partita_iva:
                by_id[partita_iva] = record
            if codice_fiscale:
                by_id[codice_fiscale] = record
    return {"by_id": by_id, "records": records}


def match_registry(path, text, registry, identifiers):
    for candidate in identifiers:
        if candidate in registry["by_id"]:
            return candidate, registry["by_id"][candidate], "id"

    source_tokens = name_tokens(path.stem)
    if not source_tokens:
        return "", None, ""

    source_key = norm_name(path.stem)
    exact = [record for record in registry["records"] if record.get("name_key") == source_key]
    if len(exact) == 1:
        record = exact[0]
        identifier = (record.get("identifiers") or [path.stem])[0]
        return identifier, record, "exact_name"

    scored = []
    for record in registry["records"]:
        tokens = record.get("name_tokens") or []
        if not tokens:
            continue
        common = len(set(source_tokens) & set(tokens))
        if common == 0:
            continue
        all_source_found = all(token in tokens for token in source_tokens)
        all_record_found = len(tokens) <= 3 and all(token in source_tokens for token in tokens)
        if all_source_found or all_record_found or common >= min(2, len(source_tokens)):
            has_id = 1 if record.get("identifiers") else 0
            has_ateco = 1 if record.get("ateco") else 0
            scored.append((common, has_id, has_ateco, -len(tokens), record))

    if not scored:
        return "", None, ""
    scored.sort(key=lambda item: (item[0], item[1], item[2], item[3]), reverse=True)
    record = scored[0][4]
    identifier = (record.get("identifiers") or [path.stem])[0]
    return identifier, record, "name"


def detect_forma(text):
    v = norm_header(text)
    if "srl" in v or "s.r.l" in v:
        return "srl"
    if "sas" in v or "s.a.s" in v:
        return "sas"
    if "snc" in v or "s.n.c" in v:
        return "snc"
    if "ditta" in v or "individuale" in v:
        return "d.i."
    if "associa" in v:
        return "associazione"
    return ""


def selected_sheets(sheets, forma):
    ce = [s for s in sheets if any(re.search(p, s["name"], re.I) for p in CE_PATTERNS)]
    sp = [s for s in sheets if any(re.search(p, s["name"], re.I) for p in SP_PATTERNS)]
    if forma == "srl":
        return sp + [s for s in ce if s not in sp] or sheets
    if forma in {"sas", "snc", "d.i.", "associazione"}:
        return ce or [s for s in sheets if s not in sp]
    return ce or sheets


def update_shared_string(text, allowed, identifiers):
    value = str(text or "")
    for identifier in identifiers:
        value = value.replace(identifier, "[omesso]")
    value = re.sub(r"[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]", "[omesso]", value, flags=re.I)
    value = re.sub(r"(?<![0-9])[0-9]{11}(?![0-9])", "[omesso]", value)
    value = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[omesso]", value, flags=re.I)
    return value


def add_metadata_sheet(temp_dir, workbook_root, rels_root, content_types_root, meta):
    worksheets = temp_dir / "xl" / "worksheets"
    worksheets.mkdir(parents=True, exist_ok=True)
    existing = list(worksheets.glob("sheet*.xml"))
    next_idx = len(existing) + 1
    sheet_name = f"sheet{next_idx}.xml"
    sheet_id = str(next_idx)
    rel_id = f"rId_auto_meta_{next_idx}"

    rows = [["campo", "valore"]] + [[k, v] for k, v in meta.items()]
    sheet_xml = make_sheet_xml(rows)
    (worksheets / sheet_name).write_text(sheet_xml, encoding="utf-8", newline="")

    sheets_el = workbook_root.find("main:sheets", NS)
    sheet_el = ET.Element(f"{{{NS['main']}}}sheet", {
        "name": "Metadati anonimizzati",
        "sheetId": sheet_id,
        f"{{{NS['officeRel']}}}id": rel_id,
    })
    sheets_el.insert(0, sheet_el)

    ET.SubElement(rels_root, f"{{{NS['rel']}}}Relationship", {
        "Id": rel_id,
        "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        "Target": f"worksheets/{sheet_name}",
    })

    override_exists = any(
        el.attrib.get("PartName") == f"/xl/worksheets/{sheet_name}"
        for el in content_types_root
    )
    if not override_exists:
        content_ns = ""
        if content_types_root.tag.startswith("{"):
            content_ns = content_types_root.tag.split("}", 1)[0].strip("{")
        override_tag = f"{{{content_ns}}}Override" if content_ns else "Override"
        ET.SubElement(content_types_root, override_tag, {
            "PartName": f"/xl/worksheets/{sheet_name}",
            "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
        })


def col_name(idx):
    out = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        out = chr(65 + rem) + out
    return out


def make_sheet_xml(rows):
    root = ET.Element(f"{{{NS['main']}}}worksheet")
    sheet_data = ET.SubElement(root, f"{{{NS['main']}}}sheetData")
    for r_idx, row in enumerate(rows, 1):
        row_el = ET.SubElement(sheet_data, f"{{{NS['main']}}}row", {"r": str(r_idx)})
        for c_idx, value in enumerate(row):
            ref = f"{col_name(c_idx)}{r_idx}"
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                c_el = ET.SubElement(row_el, f"{{{NS['main']}}}c", {"r": ref})
                v_el = ET.SubElement(c_el, f"{{{NS['main']}}}v")
                v_el.text = str(value)
            else:
                c_el = ET.SubElement(row_el, f"{{{NS['main']}}}c", {"r": ref, "t": "inlineStr"})
                is_el = ET.SubElement(c_el, f"{{{NS['main']}}}is")
                t_el = ET.SubElement(is_el, f"{{{NS['main']}}}t")
                t_el.text = str(value or "")
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + ET.tostring(root, encoding="unicode")


def sanitize_rows(rows, match, identifiers, stats):
    raw_name = str(match.get("name") or "").strip()
    sanitized = []
    for row in rows:
        joined = " ".join(str(value or "") for value in row)
        sensitive_row = any(re.search(pattern, joined, re.I) for pattern in SENSITIVE_LABELS)
        clean_row = []
        for idx, cell in enumerate(row):
            if isinstance(cell, (int, float)) and not isinstance(cell, bool):
                clean_row.append(cell)
                continue
            value = str(cell or "")
            original = value
            for identifier in identifiers:
                if identifier:
                    value = re.sub(re.escape(identifier), "[omesso]", value, flags=re.I)
            value = re.sub(r"[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]", "[omesso]", value, flags=re.I)
            value = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[omesso]", value, flags=re.I)
            if raw_name:
                value = re.sub(re.escape(raw_name), "[omesso]", value, flags=re.I)
            if len(set(name_tokens(value)) & set(match.get("name_tokens") or [])) >= 2:
                value = "[omesso]"
            if sensitive_row and value.strip():
                is_label = any(re.search(pattern, value, re.I) for pattern in SENSITIVE_LABELS)
                if not is_label:
                    value = "[omesso]"
            elif re.search(r"\b(?:via|viale|piazza|corso|vicolo|largo)\b", value, re.I):
                value = "[omesso]"
            if value != original:
                stats["cellsRedacted"] += 1
            clean_row.append(value)
        sanitized.append(clean_row)
    return sanitized


def residual_findings(rows, match, identifiers):
    findings = []
    raw_name = norm_name(match.get("name"))
    for row_idx, row in enumerate(rows, 1):
        for col_idx, cell in enumerate(row, 1):
            if not isinstance(cell, str) or not cell.strip():
                continue
            normalized = norm_name(cell)
            reasons = []
            if raw_name and len(raw_name) >= 4 and raw_name in normalized:
                reasons.append("denominazione")
            if any(identifier and identifier.lower() in cell.lower() for identifier in identifiers):
                reasons.append("identificativo")
            if re.search(r"[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]", cell, re.I):
                reasons.append("codice_fiscale")
            if re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", cell, re.I):
                reasons.append("email")
            tokens = set(name_tokens(cell)) & set(match.get("name_tokens") or [])
            if len(tokens) >= 2:
                reasons.append("token_denominazione")
            if reasons:
                findings.append({"row": row_idx, "column": col_idx, "reasons": reasons})
    return findings


def write_clean_xlsx(dest, sheets):
    content_types = ET.Element("Types", xmlns="http://schemas.openxmlformats.org/package/2006/content-types")
    ET.SubElement(content_types, "Default", Extension="rels", ContentType="application/vnd.openxmlformats-package.relationships+xml")
    ET.SubElement(content_types, "Default", Extension="xml", ContentType="application/xml")
    ET.SubElement(content_types, "Override", PartName="/xl/workbook.xml", ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")
    for idx in range(1, len(sheets) + 1):
        ET.SubElement(content_types, "Override", PartName=f"/xl/worksheets/sheet{idx}.xml", ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")

    workbook = ET.Element(f"{{{NS['main']}}}workbook")
    sheets_el = ET.SubElement(workbook, f"{{{NS['main']}}}sheets")
    workbook_rels = ET.Element("Relationships", xmlns=NS["rel"])
    for idx, (name, _rows) in enumerate(sheets, 1):
        ET.SubElement(sheets_el, f"{{{NS['main']}}}sheet", {
            "name": str(name)[:31], "sheetId": str(idx), f"{{{NS['officeRel']}}}id": f"rId{idx}"
        })
        ET.SubElement(workbook_rels, "Relationship", Id=f"rId{idx}", Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", Target=f"worksheets/sheet{idx}.xml")

    package_rels = ET.Element("Relationships", xmlns=NS["rel"])
    ET.SubElement(package_rels, "Relationship", Id="rId1", Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", Target="xl/workbook.xml")

    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
        zout.writestr("[Content_Types].xml", ET.tostring(content_types, encoding="utf-8", xml_declaration=True))
        zout.writestr("_rels/.rels", ET.tostring(package_rels, encoding="utf-8", xml_declaration=True))
        zout.writestr("xl/workbook.xml", ET.tostring(workbook, encoding="utf-8", xml_declaration=True))
        zout.writestr("xl/_rels/workbook.xml.rels", ET.tostring(workbook_rels, encoding="utf-8", xml_declaration=True))
        for idx, (_name, rows) in enumerate(sheets, 1):
            zout.writestr(f"xl/worksheets/sheet{idx}.xml", make_sheet_xml(rows))


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def anonymize_xlsx(src, dest, match, forma, identifier, identifiers):
    stats = {"cellsRedacted": 0, "formulasRemoved": 0, "commentsRemoved": 0, "hiddenSheetsRemoved": 0, "externalLinksRemoved": 0, "documentPropertiesRemoved": 1}
    geo = extract_geo_from_text(workbook_text(src))
    meta = {
        "anno": YEAR,
        "cap": geo.get("cap") or match.get("cap", ""),
        "comune": geo.get("comune") or match.get("comune", ""),
        "provincia": geo.get("citta") or match.get("citta", ""),
        "codice_ateco": match.get("ateco", ""),
        "forma_giuridica": forma,
        "numero_dipendenti": match.get("dipendenti", ""),
        "id_anonimo": anon_id(identifier or src.name),
    }
    output_sheets = [("Metadati anonimizzati", [["campo", "valore"]] + [[key, value] for key, value in meta.items()])]
    all_clean_rows = []
    with zipfile.ZipFile(src) as zf:
        names = zf.namelist()
        stats["commentsRemoved"] = sum(1 for name in names if "comments" in name.lower())
        stats["externalLinksRemoved"] = sum(1 for name in names if name.startswith("xl/externalLinks/"))
        stats["documentPropertiesRemoved"] = sum(1 for name in names if name.startswith("docProps/"))
        shared = parse_shared_strings(zf)
        sheets = workbook_sheet_paths(zf)
        selected = selected_sheets(sheets, forma)
        stats["hiddenSheetsRemoved"] = max(0, len(sheets) - len(selected))
        ce_count = sp_count = other_count = 0
        for sheet in selected:
            sheet_root = ET.fromstring(zf.read(sheet["path"]))
            stats["formulasRemoved"] += len(sheet_root.findall(".//main:f", NS))
            rows = rows_from_sheet(zf, sheet["path"], shared)
            clean_rows = sanitize_rows(rows, match, identifiers, stats)
            all_clean_rows.extend(clean_rows)
            name_norm = norm_header(sheet["name"])
            if any(re.search(pattern, name_norm, re.I) for pattern in SP_PATTERNS):
                sp_count += 1
                safe_sheet_name = "Stato patrimoniale" if sp_count == 1 else f"Stato patrimoniale {sp_count}"
            elif any(re.search(pattern, name_norm, re.I) for pattern in CE_PATTERNS):
                ce_count += 1
                safe_sheet_name = "Conto economico" if ce_count == 1 else f"Conto economico {ce_count}"
            else:
                other_count += 1
                safe_sheet_name = f"Dati contabili {other_count}"
            output_sheets.append((safe_sheet_name, clean_rows))
    findings = residual_findings(all_clean_rows, match, identifiers)
    if findings:
        raise RuntimeError(f"scansione residui non superata: {len(findings)} celle")
    write_clean_xlsx(dest, output_sheets)
    fix_file_permissions(dest)
    return {
        "status": "passed",
        "sourceSha256": file_sha256(src),
        "outputSha256": file_sha256(dest),
        "sheetCount": len(output_sheets),
        "residualFindings": 0,
        "transformations": stats,
    }


def fix_file_permissions(path):
    try:
        Path(path).chmod(0o644)
    except Exception:
        pass
    try:
        shutil.chown(path, user="www-data", group="www-data")
    except Exception:
        pass


def output_name(match, forma, index):
    return f"{safe_name(match.get('ateco', 'ateco_nd'))}_{safe_name(forma or 'forma_nd')}_{index:03d}.xlsx"


def scan_nextcloud_path(path):
    rel = path.relative_to(DATA_ROOT).as_posix()
    subprocess.run(
        ["php", "/var/www/html/occ", "files:scan", "--path", rel],
        cwd="/var/www/html",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def safe_json_write(path, payload):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
    fix_file_permissions(path)


def quarantine_previous_exports():
    old_files = [p for p in DEST_DIR.iterdir() if p.is_file() and p.name != EXPORT_MANIFEST.name]
    if not old_files:
        return ""
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    quarantine = PRIVATE_DIR / f"quarantine-pre-hardening-{stamp}"
    quarantine.mkdir(parents=True, exist_ok=True)
    for path in old_files:
        shutil.move(str(path), str(quarantine / path.name))
    log(f"QUARANTENA: spostati {len(old_files)} file precedenti in area privata")
    return str(quarantine)


def run():
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    registry = load_registry()
    previous_manifest = {}
    if EXPORT_MANIFEST.exists():
        try:
            previous_manifest = json.loads(EXPORT_MANIFEST.read_text(encoding="utf-8"))
        except Exception:
            previous_manifest = {}
    if previous_manifest.get("pipelineVersion") != PIPELINE_VERSION:
        quarantine_previous_exports()
        if EXPORT_MANIFEST.exists():
            EXPORT_MANIFEST.unlink()
    state = load_state()
    registry_stat = REGISTRY_FILE.stat()
    registry_signature = f"{registry_stat.st_size}:{int(registry_stat.st_mtime)}"
    files = sorted([p for p in SOURCE_DIR.iterdir() if p.suffix.lower() in {".xlsx", ".xlsm"} and p.is_file()])
    if not files:
        return

    prepared = []
    entity_counts = {}
    for path in files:
        text = workbook_text(path)
        identifiers = extract_identifiers(text)
        identifier, match, match_method = match_registry(path, text, registry, identifiers)
        entity = ""
        if match:
            entity = (match.get("identifiers") or [norm_name(match.get("name"))])[0]
            entity_counts[entity] = entity_counts.get(entity, 0) + 1
        prepared.append((path, text, identifiers, identifier, match, match_method, entity))

    manifest_items = []
    for idx, (path, text, identifiers, identifier, match, match_method, entity) in enumerate(prepared, 1):
        stat = path.stat()
        key = hashlib.sha256(path.name.encode("utf-8")).hexdigest()
        signature = f"{PIPELINE_VERSION}:{stat.st_size}:{int(stat.st_mtime)}:{registry_signature}"
        if not match:
            state[key] = {"signature": signature, "status": "blocked", "reason": "anagrafica_non_abbinata"}
            manifest_items.append({"status": "blocked", "reason": "anagrafica_non_abbinata"})
            log(f"NON ABBINATO: {path.name} identifiers={identifiers[:5]}")
            continue

        forma = normalize_forma(match.get("forma"))
        reason = ""
        if not forma:
            reason = "forma_giuridica_mancante"
        elif entity_counts.get(entity, 0) > 1:
            reason = "duplicato_cliente_anno"
        if reason:
            state[key] = {"signature": signature, "status": "blocked", "reason": reason}
            manifest_items.append({"status": "blocked", "reason": reason})
            log(f"BLOCCATO: {path.name} ({reason})")
            continue

        out_name = output_name(match, forma, idx)
        out_path = DEST_DIR / out_name
        report_path = DEST_DIR / (out_path.stem + ".anonymization-report.json")
        try:
            report = anonymize_xlsx(path, out_path, match, forma, identifier, identifiers)
            report.update({"pipelineVersion": PIPELINE_VERSION, "processedAt": dt.datetime.now().isoformat(timespec="seconds")})
            safe_json_write(report_path, report)
            scan_nextcloud_path(out_path)
            state[key] = {"signature": signature, "status": "passed", "output": out_name, "outputSha256": report["outputSha256"], "processed_at": report["processedAt"]}
            manifest_items.append({"status": "passed", "output": out_name, "report": report_path.name, "sha256": report["outputSha256"]})
            log(f"OK: {path.name} -> {out_name} ({match_method})")
        except Exception as exc:
            if out_path.exists():
                out_path.unlink()
            if report_path.exists():
                report_path.unlink()
            state[key] = {"signature": signature, "status": "blocked", "reason": "controllo_anonimizzazione_fallito"}
            manifest_items.append({"status": "blocked", "reason": "controllo_anonimizzazione_fallito"})
            log(f"BLOCCATO: {path.name} ({exc})")

    counts = {status: sum(1 for item in manifest_items if item["status"] == status) for status in ("passed", "blocked")}
    manifest = {"pipelineVersion": PIPELINE_VERSION, "year": YEAR, "generatedAt": dt.datetime.now().isoformat(timespec="seconds"), "counts": counts, "items": manifest_items}
    safe_json_write(EXPORT_MANIFEST, manifest)
    save_state(state)
    scan_nextcloud_path(DEST_DIR)


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        log(f"ERRORE: {exc}")
        sys.exit(1)
