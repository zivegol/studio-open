#!/usr/bin/env python3
import json
import csv
import hashlib
import re
import shutil
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

DATA_ROOT = Path("/var/www/html/data/admin/files/studio-example/archivio studio-example")
BILANCI_ROOT = DATA_ROOT / "bilanci analitici"
REGISTRY_PATH = DATA_ROOT / "adempimenti CLIENTI.xlsx"
OUT_PATH = Path("/var/www/html/studio-apps/bilanci-analytics/analytics-data.json")
OUT_JS_PATH = Path("/var/www/html/studio-apps/bilanci-analytics/analytics-data.js")
SUMMARY_SOURCE = DATA_ROOT / "LAVORI studio-example" / "studio-example LAVORI 2026" / "15441265.xlsx"
IMPORT_REVIEW_PATH = Path("/var/www/html/data/admin/files/Studio/Bilanci/Private/analytical-import-review.json")
APPROVED_EXACT_NAME_CODES = {
    "CIRPUN",  # CIRCOLO IL PUNTO
    "SOC128",  # SOCIETA' AGRICOLA MELCHIORI VITTORIO E FIGLI S.S.
    "ASDFUM",  # ASD FUMANESE CALCIO
    "PETRGI",  # PETRAROTA GIOVANNI
    "TRIMA",   # TRIDA MARIA MARTA
    "TEMASS",  # TEDESCHI MASSIMO
}
NATIONAL_EXPORT_DIR = DATA_ROOT / "bilanci analitici" / "EXPORT DATABASE NAZIONALE" / "ARCHIVIO ANALITICO"
DOSSIER_INDEX_PATH = Path("/var/www/html/data/admin/files/Studio/DossierClienti/private/dossier-index.json")

NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def fix_file_permissions(path):
    try:
        Path(path).chmod(0o644)
    except Exception:
        pass
    try:
        shutil.chown(path, user="www-data", group="www-data")
    except Exception:
        pass


def norm(value):
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", text).strip()


def name_tokens(value):
    stop = {"e", "c", "di", "del", "della", "snc", "sas", "srl", "spa", "societa"}
    text = re.sub(r"[^a-z0-9]+", " ", norm(value))
    return [token for token in text.split() if len(token) >= 3 and token not in stop]


def clean_id(value):
    if isinstance(value, (int, float)) and float(value).is_integer():
        return str(int(value))
    return re.sub(r"[^A-Za-z0-9]", "", "" if value is None else str(value)).upper()


def normalize_legal_form(value):
    value = norm(value)
    if re.search(r"s\.?\s*r\.?\s*l|responsabilita limitata", value):
        return "srl"
    if re.search(r"s\.?\s*a\.?\s*s", value):
        return "sas"
    if re.search(r"s\.?\s*n\.?\s*c", value):
        return "snc"
    if "individuale" in value or re.search(r"\bd\.?\s*i\.?\b", value):
        return "d.i."
    return value


def revenue_class(value):
    if value is None:
        return "Non disponibile"
    value = abs(float(value))
    if value < 100000:
        return "Fino a 100 mila"
    if value < 250000:
        return "100-250 mila"
    if value < 500000:
        return "250-500 mila"
    if value < 1000000:
        return "500 mila-1 milione"
    if value < 5000000:
        return "1-5 milioni"
    return "Oltre 5 milioni"


def employee_class(value):
    if value is None:
        return "Non disponibile"
    value = float(value)
    if value == 0:
        return "0"
    if value <= 5:
        return "1-5"
    if value <= 10:
        return "6-10"
    if value <= 25:
        return "11-25"
    if value <= 50:
        return "26-50"
    return "Oltre 50"


def as_number(value):
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip()
    if not text:
        return None
    text = re.sub(r"[^\d,.\-]", "", text)
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def cell_col(ref):
    letters = re.sub(r"[^A-Z]", "", ref.upper())
    col = 0
    for ch in letters:
        col = col * 26 + ord(ch) - 64
    return max(col - 1, 0)


def xml_root(zf, name):
    return ET.fromstring(zf.read(name))


def read_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = xml_root(zf, "xl/sharedStrings.xml")
    strings = []
    for si in root.findall(f"{NS_MAIN}si"):
        parts = []
        for text in si.iter(f"{NS_MAIN}t"):
            parts.append(text.text or "")
        strings.append("".join(parts))
    return strings


def read_sheets(path):
    with zipfile.ZipFile(path) as zf:
        shared = read_shared_strings(zf)
        workbook = xml_root(zf, "xl/workbook.xml")
        rels = xml_root(zf, "xl/_rels/workbook.xml.rels")
        relmap = {}
        for rel in rels.findall(f"{NS_PKG_REL}Relationship"):
            target = rel.attrib.get("Target", "")
            if not target.startswith("/"):
                target = "xl/" + target
            relmap[rel.attrib.get("Id")] = target.lstrip("/")

        sheets = {}
        for sheet in workbook.findall(f"{NS_MAIN}sheets/{NS_MAIN}sheet"):
            name = sheet.attrib.get("name", "Sheet")
            rid = sheet.attrib.get(f"{NS_REL}id")
            target = relmap.get(rid)
            if not target or target not in zf.namelist():
                continue
            root = xml_root(zf, target)
            rows = []
            for row in root.findall(f".//{NS_MAIN}row"):
                values = []
                for cell in row.findall(f"{NS_MAIN}c"):
                    idx = cell_col(cell.attrib.get("r", "A1"))
                    while len(values) <= idx:
                        values.append("")
                    ctype = cell.attrib.get("t")
                    value = ""
                    if ctype == "inlineStr":
                        parts = [t.text or "" for t in cell.iter(f"{NS_MAIN}t")]
                        value = "".join(parts)
                    else:
                        v = cell.find(f"{NS_MAIN}v")
                        if v is not None and v.text is not None:
                            if ctype == "s":
                                try:
                                    value = shared[int(v.text)]
                                except Exception:
                                    value = v.text
                            else:
                                num = as_number(v.text)
                                value = num if num is not None else v.text
                    values[idx] = value
                rows.append(values)
            sheets[name] = rows
        return sheets


def first_number(row, start, end):
    for value in row[start : min(end + 1, len(row))]:
        num = as_number(value)
        if num is not None:
            return num
    return None


def workbook_text(sheets):
    blocks = []
    for name, rows in sheets.items():
        blocks.append(name)
        blocks.extend(" ".join(str(v) for v in row if v not in ("", None)) for row in rows)
    return "\n".join(blocks)


def sheet_rows(sheets, needle):
    for name, rows in sheets.items():
        haystack = norm(name + "\n" + "\n".join(" ".join(str(v) for v in row) for row in rows[:20]))
        if needle in haystack:
            return rows
    return next(iter(sheets.values()), [])


def find_ce(rows):
    values = {
        "revenues": None,
        "costs": None,
        "purchases": None,
        "services": None,
        "leases": None,
        "personnel": None,
        "amortization": None,
        "financialCharges": None,
        "taxes": None,
    }
    for row in rows:
        left = norm(" ".join(str(v) for v in row[:14]))
        right = norm(" ".join(str(v) for v in row[14:]))
        if values["costs"] is None and "costi" in left:
            values["costs"] = first_number(row, 7, 12)
        if values["revenues"] is None and "ricavi" in right:
            values["revenues"] = first_number(row, 20, 27)
        if values["purchases"] is None and "costi per acquisto" in left:
            values["purchases"] = first_number(row, 7, 12)
        if values["services"] is None and "costi per servizi" in left:
            values["services"] = first_number(row, 7, 12)
        if values["leases"] is None and "godimento beni di terzi" in left:
            values["leases"] = first_number(row, 7, 12)
        if values["personnel"] is None and "costi per il personale" in left:
            values["personnel"] = first_number(row, 7, 12)
        if values["amortization"] is None and ("ammortament" in left or "amm.ti" in left):
            values["amortization"] = first_number(row, 7, 12)
        if values["financialCharges"] is None and "oneri finanziari" in left:
            values["financialCharges"] = first_number(row, 7, 12)
        if values["taxes"] is None and "imposte sul reddito" in left:
            values["taxes"] = first_number(row, 7, 12)
    return values


def find_sp(rows):
    values = {
        "assets": None,
        "liabilitiesAndEquity": None,
        "debts": None,
        "equity": None,
        "receivables": None,
        "cash": None,
        "inventory": None,
    }
    for row in rows:
        left = norm(" ".join(str(v) for v in row[:12]))
        right = norm(" ".join(str(v) for v in row[12:]))
        if "totale attivo" in left:
            values["assets"] = first_number(row, 7, 11)
        elif values["assets"] is None and left.strip() == "attivo":
            values["assets"] = first_number(row, 7, 11)
        if "totale passivo" in right:
            values["liabilitiesAndEquity"] = first_number(row, 14, 18)
        elif values["liabilitiesAndEquity"] is None and "passivo e patrimonio netto" in right:
            values["liabilitiesAndEquity"] = first_number(row, 14, 18)
        if values["debts"] is None and "debiti" in right:
            values["debts"] = first_number(row, 14, 18)
        if values["equity"] is None and "patrimonio netto" in right and "passivo e patrimonio netto" not in right:
            values["equity"] = first_number(row, 14, 18)
        if values["receivables"] is None and "crediti" in left:
            values["receivables"] = first_number(row, 7, 11)
        if values["cash"] is None and "disponibilita" in left and "liquide" in left:
            values["cash"] = first_number(row, 7, 11)
        if values["inventory"] is None and "rimanenze" in left:
            values["inventory"] = first_number(row, 7, 11)
    return values


def extract_analytical_lines(rows, statement_type):
    lines = []
    for row_index, row in enumerate(rows, 1):
        segments = [row[:14], row[14:]] if len(row) > 14 else [row]
        for segment_index, segment in enumerate(segments):
            texts = [str(value).strip() for value in segment if isinstance(value, str) and str(value).strip()]
            numeric_cells = [value for value in segment if isinstance(value, (int, float)) or re.fullmatch(r"\s*-?[\d.,]+\s*", str(value or ""))]
            numbers = [as_number(value) for value in numeric_cells if as_number(value) is not None]
            if not texts or not numbers:
                continue
            description = " ".join(texts)
            if re.search(r"ragione sociale|codice fiscale|partita iva|indirizzo|cliente", norm(description)):
                continue
            classification = "Ricavi" if statement_type == "CE" and segment_index == 1 else "Costi" if statement_type == "CE" else statement_type
            lines.append({
                "chartCode": "", "accountCode": "", "description": description[:240],
                "classification": classification, "statementType": statement_type,
                "netAmount": numbers[-1], "taxableAmount": None, "nondeductibleVat": None,
                "ceeClass": classify_analytical_account(description, classification) if statement_type == "CE" else "SP_ANALITICO",
                "sourceRow": row_index,
            })
    return lines


def load_registry():
    by_id = {}
    records = []
    if not REGISTRY_PATH.exists():
        return {"by_id": by_id, "records": records}
    sheets = read_sheets(REGISTRY_PATH)
    rows = None
    for name, sheet_rows_ in sheets.items():
        if norm(name) == "elenco clienti 2026":
            rows = sheet_rows_
            break
    rows = rows or next(iter(sheets.values()), [])
    header = rows[0] if rows else []
    employee_in_c = len(header) > 2 and re.search(r"dipend|addett|n\.", norm(header[2]))
    for row in rows[1:]:
        piva = clean_id(row[0] if len(row) > 0 else "")
        cf = clean_id(row[1] if len(row) > 1 else "")
        employees = as_number(row[2]) if employee_in_c and len(row) > 2 else None
        name = str(row[3] if employee_in_c and len(row) > 3 else row[2] if len(row) > 2 else "").strip()
        legal = str(row[4] if employee_in_c and len(row) > 4 else row[3] if len(row) > 3 else "").strip()
        ateco = clean_id(row[5] if employee_in_c and len(row) > 5 else row[4] if len(row) > 4 else "")
        item = {
            "name": name,
            "nameKey": norm(name),
            "legalForm": legal,
            "ateco": ateco,
            "employees": employees,
            "identifiers": [x for x in (piva, cf) if x],
            "nameTokens": name_tokens(name),
        }
        if item["nameTokens"]:
            records.append(item)
        if piva:
            by_id[piva] = item
        if cf:
            by_id[cf] = item
    return {"by_id": by_id, "records": records}


def augment_registry_from_dossiers(registry):
    if not DOSSIER_INDEX_PATH.exists():
        return registry
    try:
        clients = json.loads(DOSSIER_INDEX_PATH.read_text(encoding="utf-8")).get("clients", [])
    except Exception:
        return registry
    known_names = {item.get("nameKey") for item in registry["records"]}
    for client in clients:
        identity, facts = client.get("identity", {}), client.get("facts", {})
        name = str(identity.get("displayName") or "").strip()
        identifiers = [clean_id(value) for value in (identity.get("taxCode"), identity.get("vatNumber")) if clean_id(value)]
        if not name or not identifiers:
            continue
        name_key = norm(name)
        existing = next((item for item in registry["records"] if item.get("nameKey") == name_key), None)
        item = existing or {
            "name": name, "nameKey": name_key, "legalForm": (facts.get("formaGiuridica") or {}).get("value") or "",
            "ateco": (facts.get("ateco") or {}).get("value") or "", "employees": as_number((facts.get("dipendenti") or {}).get("value")),
            "identifiers": [], "nameTokens": name_tokens(name),
        }
        item["identifiers"] = list(dict.fromkeys((item.get("identifiers") or []) + identifiers))
        if not existing and name_key not in known_names:
            registry["records"].append(item)
            known_names.add(name_key)
        for identifier in identifiers:
            registry["by_id"].setdefault(identifier, item)
    return registry


def match_registry(path, registry, ids):
    for ident in ids:
        if ident in registry["by_id"]:
            return registry["by_id"][ident]

    source_tokens = name_tokens(path.stem)
    scored = []
    for record in registry["records"]:
        tokens = record.get("nameTokens") or []
        if not source_tokens or not tokens:
            continue
        common = len(set(source_tokens) & set(tokens))
        if common == 0:
            continue
        all_source_found = all(token in tokens for token in source_tokens)
        all_record_found = len(tokens) <= 3 and all(token in source_tokens for token in tokens)
        if all_source_found or all_record_found or common >= min(2, len(source_tokens)):
            scored.append((
                common,
                1 if record.get("identifiers") else 0,
                1 if record.get("ateco") else 0,
                -len(tokens),
                record,
            ))
    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], item[1], item[2], item[3]), reverse=True)
    return scored[0][4]


def balance_sheet_totals(sp):
    assets = sp["assets"]
    debts = sp["debts"]
    equity_raw = sp["equity"]
    liabilities_raw = sp["liabilitiesAndEquity"]
    equity = equity_raw
    liabilities = liabilities_raw
    adjustment = None
    if assets is not None and debts is not None:
        computed_equity = assets - debts
        if liabilities_raw is None or abs(liabilities_raw - assets) > 1:
            liabilities = assets
            equity = computed_equity
            if equity_raw is not None and abs(computed_equity - equity_raw) > 1:
                adjustment = computed_equity - equity_raw
    return equity, liabilities, equity_raw, liabilities_raw, adjustment


def recalculate_metrics(record):
    """Recalculate ratios from the authoritative values stored on a record."""
    production_value = record.get("productionValue")
    if production_value is None:
        production_value = record.get("revenues")
    production_costs = record.get("productionCosts")
    if production_costs is None:
        production_costs = record.get("costs")
    ebit = record.get("operatingDifference")
    if ebit is None and production_value is not None and production_costs is not None:
        ebit = production_value - production_costs
    depreciation = record.get("depreciationWriteDowns")
    if depreciation is None:
        depreciation = record.get("amortization")
    ebitda = ebit + depreciation if ebit is not None and depreciation is not None else record.get("ebitda")
    assets, debts, equity = record.get("assets"), record.get("debts"), record.get("equity")
    result = record.get("result")
    employees = record.get("employees") if (record.get("employees") or 0) > 0 else None
    current_assets = record.get("currentAssets")
    if current_assets is None:
        current_assets = sum(v for v in (record.get("inventory"), record.get("receivables"), record.get("cash")) if v is not None)
    record.update({
        "revenues": production_value,
        "costs": production_costs,
        "ebit": ebit,
        "ebitda": ebitda,
        "ebitdaMargin": ebitda / production_value if ebitda is not None and production_value else None,
        "ros": ebit / production_value if ebit is not None and production_value else None,
        "roi": ebit / assets if ebit is not None and assets else None,
        "roe": result / equity if result is not None and equity else None,
        "margin": result / production_value if result is not None and production_value else None,
        "debtRatio": debts / assets if debts is not None and assets else None,
        "currentRatio": current_assets / record.get("shortTermDebts") if current_assets and record.get("shortTermDebts") else None,
        "revenuePerEmployee": production_value / employees if employees and production_value else None,
        "resultPerEmployee": result / employees if employees and result is not None else None,
        "costsPerEmployee": production_costs / employees if employees and production_costs else None,
        "revenueClass": revenue_class(production_value),
    })
    return record


def merge_dossier_financials(records):
    """Overlay verified XBRL figures and add missing historical years."""
    if not DOSSIER_INDEX_PATH.exists():
        return records
    try:
        clients = json.loads(DOSSIER_INDEX_PATH.read_text(encoding="utf-8")).get("clients", [])
    except Exception:
        return records

    for client in clients:
        identity, facts = client.get("identity", {}), client.get("facts", {})
        name = str(identity.get("displayName") or "").strip()
        if not name:
            continue
        client_ids = {clean_id(value) for value in (identity.get("taxCode"), identity.get("vatNumber")) if clean_id(value)}
        name_key = norm(name)
        client_records = []
        for record in records:
            record_ids = set(re.findall(r"[A-Z0-9]{11,16}", str(record.get("fiscalIds") or "").upper()))
            record_name = norm(record.get("clientName"))
            if (client_ids and record_ids.intersection(client_ids)) or record_name == name_key or record_name.startswith(name_key + " ") or name_key.startswith(record_name + " "):
                client_records.append(record)
        if not client_records:
            continue
        template = client_records[0]
        employees = as_number((facts.get("dipendenti") or {}).get("value")) or template.get("employees")
        for statement in client.get("bilanci", []):
            if statement.get("quality") != "verified_xbrl" or not statement.get("year"):
                continue
            year = str(statement["year"])
            record = next((item for item in client_records if str(item.get("year")) == year), None)
            if record is None:
                source = statement.get("source") or {}
                record = {
                    "id": f"xbrl-{client.get('clientId')}-{year}",
                    "fileName": source.get("displayName") or f"Bilancio XBRL {year}",
                    "sourcePath": source.get("sourcePath") or "",
                    "year": year,
                    "clientName": template.get("clientName") or name,
                    "legalForm": template.get("legalForm") or (facts.get("formaGiuridica") or {}).get("value") or "",
                    "ateco": template.get("ateco") or (facts.get("ateco") or {}).get("value") or "",
                    "employees": employees,
                    "cap": template.get("cap") or "", "comune": template.get("comune") or "", "provincia": template.get("provincia") or "",
                    "fiscalIds": ", ".join(sorted(client_ids)), "analyticalAccounts": [], "dataShape": "cee_xbrl",
                }
                records.append(record)
                client_records.append(record)
            elif record.get("assets") is not None and statement.get("assets") is not None and abs(record["assets"] - statement["assets"]) > 1:
                record["assetsGross"] = record["assets"]
            source = statement.get("source") or {}
            record["financialStatementSource"] = "xbrl"
            record["officialSourceName"] = source.get("displayName")
            record["officialSourcePath"] = source.get("sourcePath")
            record["spBalancingAdjustment"] = None
            field_map = {
                "productionValue": "productionValue", "productionCosts": "productionCosts", "revenues": "revenues",
                "purchases": "rawMaterialsCosts", "services": "serviceCosts", "leases": "leaseCosts", "personnel": "personnelCosts",
                "amortization": "depreciationWriteDowns", "depreciationWriteDowns": "depreciationWriteDowns",
                "financialCharges": "financialCharges", "taxes": "incomeTaxes", "result": "result", "operatingDifference": "operatingDifference",
                "assets": "assets", "liabilitiesAndEquity": "liabilities", "liabilities": "liabilities", "debts": "debts", "equity": "equity",
                "shareholderReceivables": "shareholderReceivables", "fixedAssets": "fixedAssets", "intangibleAssets": "intangibleAssets",
                "tangibleAssets": "tangibleAssets", "financialFixedAssets": "financialFixedAssets", "currentAssets": "currentAssets",
                "inventory": "inventories", "inventories": "inventories", "receivables": "receivables", "currentFinancialAssets": "currentFinancialAssets",
                "cash": "cash", "assetAccruals": "assetAccruals", "provisions": "provisions", "employeeTermination": "employeeTermination",
                "shortTermDebts": "shortTermDebts", "longTermDebts": "longTermDebts", "liabilityAccruals": "liabilityAccruals",
            }
            for target, source_key in field_map.items():
                if statement.get(source_key) is not None:
                    record[target] = statement[source_key]
            record["employees"] = employees
            recalculate_metrics(record)
    return records


def parse_file(path, year, registry):
    sheets = read_sheets(path)
    text = workbook_text(sheets)
    ids = set(re.findall(r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b", text.upper()))
    ids.update(re.findall(r"\b\d{11}\b", text))
    client = match_registry(path, registry, ids)
    if client is None:
        client = {"name": path.stem, "legalForm": "", "ateco": "", "employees": None}

    geo_match = re.search(r"\b(\d{5})\s+([A-Za-zÀ-ÖØ-öø-ÿ' .-]{2,80}?)\s*\(([A-Z]{2})\)", text)
    cap, comune, provincia = ("", "", "")
    if geo_match:
        cap, comune, provincia = geo_match.group(1), geo_match.group(2).strip(), geo_match.group(3)

    ce_rows = sheet_rows(sheets, "conto economico")
    sp_rows = sheet_rows(sheets, "stato patrimoniale")
    ce = find_ce(ce_rows)
    sp = find_sp(sp_rows)
    equity, liabilities_and_equity, equity_raw, liabilities_raw, sp_adjustment = balance_sheet_totals(sp)
    revenues = ce["revenues"]
    costs = ce["costs"]
    result = revenues - costs if revenues is not None and costs is not None else None
    margin = result / revenues if result is not None and revenues else None
    operating_inputs = sum(v for v in (ce["purchases"], ce["services"], ce["leases"], ce["personnel"]) if v is not None)
    ebitda = revenues - operating_inputs if revenues is not None and operating_inputs else None
    ebit = ebitda - ce["amortization"] if ebitda is not None and ce["amortization"] is not None else None
    ebitda_margin = ebitda / revenues if ebitda is not None and revenues else None
    ros = ebit / revenues if ebit is not None and revenues else None
    roi = ebit / sp["assets"] if ebit is not None and sp["assets"] else None
    roe = result / equity if result is not None and equity else None
    debt_ratio = sp["debts"] / sp["assets"] if sp["debts"] is not None and sp["assets"] else None
    current_assets = sum(v for v in (sp["receivables"], sp["cash"], sp["inventory"]) if v is not None)
    current_ratio = current_assets / sp["debts"] if current_assets and sp["debts"] else None
    employees = client.get("employees")
    employees = employees if employees and employees > 0 else None
    revenue_per_employee = revenues / employees if employees and revenues else None
    result_per_employee = result / employees if employees and result is not None else None
    costs_per_employee = costs / employees if employees and costs else None

    return {
        "id": f"{year}-{path.name}",
        "fileName": path.name,
        "sourcePath": path.relative_to(DATA_ROOT).as_posix(),
        "year": str(year),
        "clientName": client.get("name") or path.stem,
        "legalForm": client.get("legalForm") or "",
        "ateco": client.get("ateco") or "",
        "employees": employees,
        "cap": cap,
        "comune": comune,
        "provincia": provincia,
        "fiscalIds": ", ".join(sorted(ids)),
        "revenues": revenues,
        "costs": costs,
        "purchases": ce["purchases"],
        "services": ce["services"],
        "leases": ce["leases"],
        "personnel": ce["personnel"],
        "amortization": ce["amortization"],
        "financialCharges": ce["financialCharges"],
        "taxes": ce["taxes"],
        "ebitda": ebitda,
        "ebitdaMargin": ebitda_margin,
        "ebit": ebit,
        "ros": ros,
        "roi": roi,
        "roe": roe,
        "result": result,
        "margin": margin,
        "assets": sp["assets"],
        "liabilitiesAndEquity": liabilities_and_equity,
        "liabilitiesAndEquityRaw": liabilities_raw,
        "debts": sp["debts"],
        "equity": equity,
        "equityRaw": equity_raw,
        "spBalancingAdjustment": sp_adjustment,
        "receivables": sp["receivables"],
        "cash": sp["cash"],
        "inventory": sp["inventory"],
        "debtRatio": debt_ratio,
        "currentRatio": current_ratio,
        "revenuePerEmployee": revenue_per_employee,
        "resultPerEmployee": result_per_employee,
        "costsPerEmployee": costs_per_employee,
        "revenueClass": revenue_class(revenues),
        "employeeClass": employee_class(employees),
        "dataShape": "ce_sp_analitico" if normalize_legal_form(client.get("legalForm")) == "srl" else "ce_analitico",
        "analyticalAccounts": extract_analytical_lines(ce_rows, "CE") + (extract_analytical_lines(sp_rows, "SP") if normalize_legal_form(client.get("legalForm")) == "srl" else []),
    }


def classify_analytical_account(description, classification):
    value = norm(description)
    if norm(classification) == "ricavi":
        return "A1_RICAVI"
    if re.search(r"mater|merci|acquist|consumo|carburant", value):
        return "B6_MATERIE_E_MERCI"
    if re.search(r"nolegg|locaz|leasing|godimento", value):
        return "B8_GODIMENTO_BENI_TERZI"
    if re.search(r"personale|stipend|salari|contribut|tfr", value):
        return "B9_PERSONALE"
    if re.search(r"ammort|svalut", value):
        return "B10_AMMORTAMENTI"
    if re.search(r"interess|oneri finanziar|commissioni banc", value):
        return "C_ONERI_FINANZIARI"
    if re.search(r"impost|tassa|irap|ires|irpef", value):
        return "IMPOSTE"
    if re.search(r"serviz|consul|utenze|assicur|manutenz|trasport|software|pubblic", value):
        return "B7_SERVIZI"
    return "B14_ALTRI_COSTI"


def load_summary_analytical_records(registry):
    if not SUMMARY_SOURCE.exists():
        return [], {"sourceMissing": True, "items": []}
    rows = read_sheets(SUMMARY_SOURCE).get("Layout_1", [])
    by_name = {}
    for item in registry["records"]:
        by_name.setdefault(item.get("nameKey"), []).append(item)
    grouped = {}
    review = []
    for row in rows[1:]:
        if len(row) < 16 or not row[0] or not row[1]:
            continue
        company_code, source_name = str(row[0]), str(row[1]).strip()
        tax_code, vat_number = clean_id(row[2]), clean_id(row[3])
        # La partita IVA identifica l'impresa; il codice fiscale puo essere quello
        # del titolare e non deve spostare i conti su una scheda personale separata.
        client = registry["by_id"].get(vat_number) or registry["by_id"].get(tax_code)
        match_method = "identifier" if client else ""
        if client is None:
            candidates = by_name.get(norm(source_name), [])
            if len(candidates) == 1:
                if company_code in APPROVED_EXACT_NAME_CODES:
                    client = candidates[0]
                    match_method = "verified_exact_name"
                else:
                    review.append({"companyCode": company_code, "sourceName": source_name, "years": [], "reason": "exact_name_requires_review"})
            if client is None:
                continue
        legal_form = normalize_legal_form(client.get("legalForm"))
        if legal_form not in {"d.i.", "sas", "snc", "srl"}:
            legal_form = normalize_legal_form(source_name)
        if legal_form not in {"d.i.", "sas", "snc", "srl"}:
            legal_form = str(client.get("legalForm") or "ALTRO").strip().upper()
        raw_year = int(as_number(row[4]) or 0)
        year = 2000 + raw_year if 0 < raw_year < 100 else raw_year
        if not year:
            continue
        key = ((client.get("identifiers") or [norm(client.get("name"))])[0], year)
        grouped.setdefault(key, {"client": client, "year": year, "companyCode": company_code, "accounts": [], "matchMethod": match_method, "legalForm": legal_form})
        grouped[key]["accounts"].append({
            "chartCode": clean_id(row[5]), "accountCode": clean_id(row[6]),
            "description": str(row[7] or "").strip(), "classification": str(row[8] or "").strip(),
            "deductiblePct": as_number(row[9]), "grossAmount": as_number(row[10]),
            "netAmount": as_number(row[11]), "taxableAmount": as_number(row[12]),
            "nondeductibleVat": as_number(row[13]), "totalVat": as_number(row[14]),
            "lastProcessing": str(row[15] or "").strip(),
            "ceeClass": classify_analytical_account(row[7], row[8]),
            "statementType": "CE",
        })
    records = []
    source_rel = SUMMARY_SOURCE.relative_to(DATA_ROOT).as_posix()
    for item in grouped.values():
        client, accounts, year = item["client"], item["accounts"], item["year"]
        revenues = sum((account.get("netAmount") or 0) for account in accounts if norm(account.get("classification")) == "ricavi")
        costs = sum((account.get("netAmount") or 0) for account in accounts if norm(account.get("classification")) == "costi")
        by_cee = {}
        for account in accounts:
            by_cee[account["ceeClass"]] = by_cee.get(account["ceeClass"], 0) + (account.get("netAmount") or 0)
        result = revenues - costs
        employees = client.get("employees") if client.get("employees") is not None else None
        records.append({
            "id": f"analytical-summary-{item['companyCode']}-{year}", "fileName": SUMMARY_SOURCE.name,
            "sourcePath": source_rel, "year": str(year), "clientName": client.get("name"),
            "legalForm": item["legalForm"].upper() if item["legalForm"] in {"sas", "snc", "srl"} else ("D.I." if item["legalForm"] == "d.i." else item["legalForm"]), "ateco": client.get("ateco") or "",
            "employees": employees, "cap": "", "comune": "", "provincia": "",
            "fiscalIds": ", ".join(client.get("identifiers") or []),
            "revenues": revenues, "costs": costs, "purchases": by_cee.get("B6_MATERIE_E_MERCI"),
            "services": by_cee.get("B7_SERVIZI"), "leases": by_cee.get("B8_GODIMENTO_BENI_TERZI"),
            "personnel": by_cee.get("B9_PERSONALE"), "amortization": by_cee.get("B10_AMMORTAMENTI"),
            "financialCharges": by_cee.get("C_ONERI_FINANZIARI"), "taxes": by_cee.get("IMPOSTE"),
            "ebitda": revenues - sum(by_cee.get(key, 0) for key in ("B6_MATERIE_E_MERCI", "B7_SERVIZI", "B8_GODIMENTO_BENI_TERZI", "B9_PERSONALE")),
            "ebit": result, "result": result, "margin": result / revenues if revenues else None,
            "revenuePerEmployee": revenues / employees if employees else None,
            "resultPerEmployee": result / employees if employees else None,
            "costsPerEmployee": costs / employees if employees else None,
            "assets": None, "debts": None, "equity": None, "receivables": None, "cash": None, "inventory": None,
            "analyticalAccounts": accounts, "dataShape": "ce_analitico", "matchMethod": item["matchMethod"],
            "revenueClass": revenue_class(revenues), "employeeClass": employee_class(employees),
        })
    unique_review = {}
    for item in review:
        unique_review[(item["companyCode"], item["sourceName"])] = item
    return records, {"source": str(SUMMARY_SOURCE), "items": list(unique_review.values()), "verifiedRecords": len(records)}


def write_national_analytical_export(records):
    NATIONAL_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = NATIONAL_EXPORT_DIR / "conti-analitici-anonimizzati.csv"
    manifest_path = NATIONAL_EXPORT_DIR / "export-manifest.json"
    fields = ["id_anonimo", "anno", "forma_giuridica", "codice_ateco", "provincia", "comune", "numero_dipendenti", "classe_dipendenti", "classe_fatturato", "tipo_prospetto", "codice_piano", "codice_conto", "descrizione_conto", "classe_cee", "classificazione", "importo_netto", "imponibile", "iva_non_detraibile"]
    output_rows = []
    for record in records:
        seed = (record.get("fiscalIds") or record.get("clientName") or record.get("id")) + "|studio-example-national-v1"
        anonymous_id = "anon_" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
        for account in record.get("analyticalAccounts", []):
            output_rows.append({
                "id_anonimo": anonymous_id, "anno": record.get("year"), "forma_giuridica": normalize_legal_form(record.get("legalForm")),
                "codice_ateco": record.get("ateco") or "", "provincia": record.get("provincia") or "", "comune": record.get("comune") or "",
                "numero_dipendenti": record.get("employees") if record.get("employees") is not None else "", "classe_dipendenti": record.get("employeeClass"),
                "classe_fatturato": record.get("revenueClass"), "tipo_prospetto": account.get("statementType") or record.get("dataShape"),
                "codice_piano": account.get("chartCode"), "codice_conto": account.get("accountCode"), "descrizione_conto": account.get("description"),
                "classe_cee": account.get("ceeClass"), "classificazione": account.get("classification"), "importo_netto": account.get("netAmount"),
                "imponibile": account.get("taxableAmount"), "iva_non_detraibile": account.get("nondeductibleVat"),
            })
    with csv_path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter=";")
        writer.writeheader()
        writer.writerows(output_rows)
    manifest = {"generatedAt": datetime.now(timezone.utc).isoformat(), "schemaVersion": "analytical-national-1.0", "records": len(output_rows), "entities": len({row['id_anonimo'] for row in output_rows}), "years": sorted({row['anno'] for row in output_rows}), "excludedFields": ["denominazione", "codice_fiscale", "partita_iva", "indirizzo", "via"], "file": csv_path.name}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    fix_file_permissions(csv_path)
    fix_file_permissions(manifest_path)
    return manifest


def main():
    registry = augment_registry_from_dossiers(load_registry())
    records = []
    errors = []
    for year_dir in sorted(BILANCI_ROOT.iterdir() if BILANCI_ROOT.exists() else []):
        if not year_dir.is_dir() or not re.fullmatch(r"\d{4}", year_dir.name):
            continue
        for file in sorted(year_dir.iterdir()):
            if file.name.startswith("~$") or not file.suffix.lower() in (".xlsx", ".xlsm"):
                continue
            try:
                records.append(parse_file(file, year_dir.name, registry))
            except Exception as exc:
                errors.append({"file": str(file), "error": str(exc)})
    summary_records, import_review = load_summary_analytical_records(registry)
    geo_by_client = {}
    for record in records:
        if record.get("provincia") or record.get("comune"):
            geo_by_client[norm(record.get("clientName"))] = {key: record.get(key) or "" for key in ("cap", "comune", "provincia")}
    for record in summary_records:
        record.update(geo_by_client.get(norm(record.get("clientName")), {}))
    existing_client_years = {(norm(record.get("clientName")), str(record.get("year"))) for record in records}
    imported_summary_records = [record for record in summary_records if (norm(record.get("clientName")), str(record.get("year"))) not in existing_client_years]
    records.extend(imported_summary_records)
    records = merge_dossier_financials(records)
    IMPORT_REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    IMPORT_REVIEW_PATH.write_text(json.dumps(import_review, ensure_ascii=False, indent=2), encoding="utf-8")
    fix_file_permissions(IMPORT_REVIEW_PATH)
    warnings = []
    seen = {}
    for record in records:
        key = (norm(record.get("clientName")), str(record.get("year") or ""))
        if key in seen:
            warnings.append({
                "type": "duplicate_client_year",
                "client": record.get("clientName"),
                "year": record.get("year"),
                "files": [seen[key], record.get("fileName")],
            })
        else:
            seen[key] = record.get("fileName")
        if not record.get("legalForm"):
            warnings.append({"type": "missing_legal_form", "file": record.get("fileName")})
        if record.get("revenues") is None:
            warnings.append({"type": "missing_income_statement", "file": record.get("fileName")})
        legal = norm(record.get("legalForm"))
        if ("srl" in legal or "responsabilita limitata" in legal) and record.get("assets") is None:
            warnings.append({"type": "missing_balance_sheet", "file": record.get("fileName")})
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "records": records,
        "errors": errors,
        "warnings": warnings,
        "sourceFileCount": len(records) + len(errors),
        "source": str(BILANCI_ROOT),
        "analyticalImport": {"source": str(SUMMARY_SOURCE), "records": len(imported_summary_records), "reviewRequired": len(import_review.get("items", []))},
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_JS_PATH.write_text(
        "window.BILANCI_ANALYTICS_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    fix_file_permissions(OUT_PATH)
    fix_file_permissions(OUT_JS_PATH)
    national_manifest = write_national_analytical_export([record for record in records if record.get("analyticalAccounts")])
    print(f"written {OUT_PATH} and {OUT_JS_PATH} with {len(records)} records and {len(errors)} errors; national={national_manifest['records']} rows")


if __name__ == "__main__":
    main()
