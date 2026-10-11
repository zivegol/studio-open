import re

PARSER_VERSION = 'unico-fiscal-2025-0.7'


def _fragments(page):
    parts = []
    def visit(text, cm, tm, _font, _size):
        clean = ' '.join(text.split())
        if not clean:
            return
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
        amount_pattern = r'-?\d{1,3}(?:\.\d{3})*(?:,00)?'
        if re.fullmatch(amount_pattern + r'(?:\s+' + amount_pattern + r')*', clean):
            for amount in re.findall(amount_pattern, clean):
                parts.append((x, y, int(amount.replace('.', '').replace(',00', ''))))
    page.extract_text(visitor_text=visit)
    return parts


def _value_at(parts, y, min_x=400, tolerance=1.8):
    values = [(abs(py - y), value) for x, py, value in parts if x >= min_x and abs(py - y) <= tolerance]
    return min(values)[1] if values else None


def _values_at(parts, y, min_x=0, tolerance=1.8):
    nearest = [(abs(py - y), index, value) for index, (x, py, value) in enumerate(parts) if x >= min_x and abs(py - y) <= tolerance]
    if not nearest:
        return []
    distance = min(item[0] for item in nearest)
    return [value for current_distance, _, value in nearest if current_distance == distance]


def _value_in_x(parts, y, min_x, max_x, tolerance=1.8):
    values = [(abs(py - y), value) for x, py, value in parts if min_x <= x < max_x and abs(py - y) <= tolerance]
    return min(values)[1] if values else None


def _fact(value, row, page_no, confidence=0.98):
    return {'value': value, 'row': row, 'page': page_no, 'confidence': confidence, 'status': 'verified'}


def _row_value(page, row, min_x=400, value_offset=65.3):
    """Read a form value relative to its printed row code, across yearly layouts."""
    label_y = []
    pattern = re.compile(r'^' + re.escape(row) + r'$')
    def visit(text, cm, tm, _font, _size):
        clean = ' '.join(text.split())
        if not pattern.match(clean):
            return
        y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
        label_y.append(y)
    page.extract_text(visitor_text=visit)
    if not label_y:
        return None
    return _value_at(_fragments(page), label_y[0] + value_offset, min_x=min_x, tolerance=2.5)


def parse_sp_rg(reader):
    """Bluenext Redditi SP 2025, RG page. Values are accepted only if totals reconcile."""
    for page_no, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ''
        if 'QUADRO RG' not in text or "Reddito d'impresa in regime" not in text:
            continue
        rows = {
            row: _row_value(page, row) for row in ('RG2','RG12','RG24','RG25','RG28','RG31','RG34')
        }
        required = ('RG12', 'RG24', 'RG25', 'RG31', 'RG34')
        if any(rows[key] is None for key in required):
            return {'status': 'review_required', 'regime': 'impresa_contabilita_semplificata', 'model': 'sp', 'page': page_no, 'reason': 'core_rows_missing'}
        checks = {
            'components_difference': rows['RG12'] - rows['RG24'] == rows['RG25'],
            'declared_income_consistency': rows['RG31'] == rows['RG34'],
        }
        if not all(checks.values()):
            return {'status': 'review_required', 'regime': 'impresa_contabilita_semplificata', 'model': 'sp', 'page': page_no, 'reason': 'reconciliation_failed', 'checks': checks}
        return {
            'status': 'verified', 'model': 'sp', 'regime': 'impresa_contabilita_semplificata',
            'parserVersion': PARSER_VERSION, 'checks': checks,
            'facts': {
                'ricavi': _fact(rows['RG2'], 'RG2', page_no),
                'componentiPositivi': _fact(rows['RG12'], 'RG12', page_no),
                'componentiNegativi': _fact(rows['RG24'], 'RG24', page_no),
                'differenza': _fact(rows['RG25'], 'RG25', page_no),
                'redditoImpresa': _fact(rows['RG31'], 'RG31', page_no),
                'redditoDichiarato': _fact(rows['RG34'], 'RG34', page_no),
            },
        }
    return {'status': 'not_applicable', 'model': 'sp'}


def parse_pf_rn_rx(reader, filing_year=2025):
    rn_index = rx_index = None
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ''
        if rn_index is None and 'QUADRO RN' in text and re.search(r'Determinazione dell.?IRPEF', text, re.I):
            rn_index = index
        if rx_index is None and 'QUADRO RX' in text and re.search(r'Risultato della dichiarazione', text, re.I):
            rx_index = index
    if rn_index is None or rn_index + 1 >= len(reader.pages) or rx_index is None:
        return {'status': 'review_required', 'model': 'pf', 'reason': 'summary_pages_missing'}
    rn1_text = reader.pages[rn_index].extract_text() or ''
    rn1 = _fragments(reader.pages[rn_index])
    rn2 = _fragments(reader.pages[rn_index + 1])
    rx = _fragments(reader.pages[rx_index])
    second_coords = {
        2022: {'RN33': 773.5, 'RN34': 761.5, 'RN36': 725.5, 'RN37': 701.5, 'RN38': 677.5, 'RN45': 569.5, 'RN46': 557.5, 'RN62': 341.5},
        2023: {'RN33': 581.1, 'RN34': 569.1, 'RN36': 533.0, 'RN37': 509.0, 'RN38': 484.9, 'RN45': 376.7, 'RN46': 364.7, 'RN62': 152.1},
        2024: {'RN33': 581.1, 'RN34': 569.1, 'RN36': 533.0, 'RN37': 509.0, 'RN38': 484.9, 'RN45': 388.7, 'RN46': 376.7, 'RN62': 164.1},
        2025: {'RN33': 581.1, 'RN34': 569.1, 'RN36': 533.0, 'RN37': 509.0, 'RN38': 484.9, 'RN45': 364.7, 'RN46': 352.7, 'RN62': 148.3},
    }[filing_year]
    rn1_values = _values_at(rn1, 689.3, min_x=80)
    rx_debit_min, rx_credit_min, rx_credit_max = (180, 260, 340) if filing_year in {2022, 2023, 2024} else (100, 180, 260)
    rows = {
        'RN1': rn1_values[-1] if rn1_values else None,
        'RN2': _value_at(rn1, 677.3, min_x=300),
        'RN3': _value_at(rn1, 665.3, min_x=300),
        'RN4': _value_at(rn1, 653.3),
        'RN5': _value_at(rn1, 641.2),
        'RN13': _value_at(rn1, 533.0),
        'RN14': _value_at(rn1, 521.0),
        'RN16': _value_at(rn1, 497.0),
        'RN22': _value_at(rn1, 376.7),
        'RN26': _value_at(rn1, 292.5),
        'RN33': _value_at(rn2, second_coords['RN33']),
        'RN34': _value_at(rn2, second_coords['RN34']),
        'RN36': _value_at(rn2, second_coords['RN36']),
        'RN37': _value_at(rn2, second_coords['RN37']),
        'RN38_acconti': _value_at(rn2, second_coords['RN38']),
        'RN45': _value_at(rn2, second_coords['RN45']),
        'RN46': _value_at(rn2, second_coords['RN46']),
        'RN62_acconto1': _value_at(rn2, second_coords['RN62'], min_x=250),
        'RN62_acconto2': _value_at(rn2, second_coords['RN62'], min_x=400),
        'RX1_debito': _value_in_x(rx, 677.3, rx_debit_min, rx_credit_min),
        'RX1_credito': _value_in_x(rx, 677.3, rx_credit_min, rx_credit_max),
        'RX2_debito': _value_in_x(rx, 665.3, rx_debit_min, rx_credit_min),
        'RX2_credito': _value_in_x(rx, 665.3, rx_credit_min, rx_credit_max),
        'RX3_debito': _value_in_x(rx, 653.3, rx_debit_min, rx_credit_min),
        'RX3_credito': _value_in_x(rx, 653.3, rx_credit_min, rx_credit_max),
    }
    if filing_year == 2025 and rows.get('RN46') is not None and rows.get('RX1_credito') != rows.get('RN46'):
        alt_debit_min, alt_credit_min, alt_credit_max = 180, 260, 340
        alt = {
            'RX1_debito': _value_in_x(rx, 677.3, alt_debit_min, alt_credit_min),
            'RX1_credito': _value_in_x(rx, 677.3, alt_credit_min, alt_credit_max),
            'RX2_debito': _value_in_x(rx, 665.3, alt_debit_min, alt_credit_min),
            'RX2_credito': _value_in_x(rx, 665.3, alt_credit_min, alt_credit_max),
            'RX3_debito': _value_in_x(rx, 653.3, alt_debit_min, alt_credit_min),
            'RX3_credito': _value_in_x(rx, 653.3, alt_credit_min, alt_credit_max),
        }
        if alt['RX1_credito'] == rows.get('RN46'):
            rows.update(alt)
    for row in ('RN4', 'RN5', 'RN26'):
        if rows[row] is None and re.search(row + r'[\s\S]{0,180}\bZERO\b', rn1_text, re.I):
            rows[row] = 0
    if rows['RN22'] is None and rows['RN5'] is not None and rows['RN26'] == rows['RN5']:
        rows['RN22'] = 0
    if rows['RN34'] is None and rows['RN36'] is not None and rows['RN46'] == rows['RN36']:
        rows['RN34'] = 0
    if rows['RN34'] is None and rows['RN46'] is not None and rows['RN38_acconti'] == rows['RN46']:
        rows['RN34'] = 0
    required = ('RN1', 'RN4', 'RN5', 'RN22', 'RN26', 'RN34')
    if any(rows[key] is None for key in required):
        return {'status': 'review_required', 'model': 'pf', 'reason': 'core_rows_missing', 'pages': [rn_index + 1, rn_index + 2, rx_index + 1]}
    if rows['RN45'] is None and rows['RN46'] is None:
        if rows['RN34'] is not None and rows['RN38_acconti'] == rows['RN34']:
            rows['RN45'] = 0
            rows['RN46'] = 0
        else:
            return {'status': 'review_required', 'model': 'pf', 'reason': 'tax_result_missing', 'pages': [rn_index + 2, rx_index + 1]}
    rn3 = rows['RN3'] or 0
    rn2 = rows['RN2'] or 0
    rn1_reference = rn1_values[0] if rn1_values else rows['RN1']
    rn1_total = rows['RN1']
    if rn1_total - rn2 - rn3 != rows['RN4'] and (rn2 or rn3):
        rn1_total = rows['RN4'] + rn2 + rn3
    debit = rows['RN45'] or 0
    credit = rows['RN46'] or 0
    checks = {
        'taxable_income': rn1_total - rn2 - rn3 == rows['RN4'],
        'net_tax': max(0, rows['RN5'] - rows['RN22']) == rows['RN26'],
        'result_to_rx': debit == (rows['RX1_debito'] or 0) and credit == (rows['RX1_credito'] or 0),
    }
    if not all(checks.values()):
        return {'status': 'review_required', 'model': 'pf', 'reason': 'reconciliation_failed', 'checks': checks, 'pages': [rn_index + 1, rn_index + 2, rx_index + 1], 'rows': rows}
    fields = {
        'redditoComplessivo': ('RN1', rn1_total, rn_index + 1),
        'deduzioneAbitazionePrincipale': ('RN2', rn2, rn_index + 1),
        'oneriDeducibili': ('RN3', rn3, rn_index + 1),
        'redditoImponibile': ('RN4', rows['RN4'], rn_index + 1),
        'impostaLorda': ('RN5', rows['RN5'], rn_index + 1),
        'detrazioniImposta': ('RN22', rows['RN22'], rn_index + 1),
        'impostaNetta': ('RN26', rows['RN26'], rn_index + 1),
        'differenzaImposta': ('RN34', rows['RN34'], rn_index + 2),
        'impostaDebito': ('RN45', debit, rn_index + 2),
        'impostaCredito': ('RN46', credit, rn_index + 2),
        'addizionaleRegionaleDebito': ('RX2', rows['RX2_debito'] or 0, rx_index + 1),
        'addizionaleRegionaleCredito': ('RX2', rows['RX2_credito'] or 0, rx_index + 1),
        'addizionaleComunaleDebito': ('RX3', rows['RX3_debito'] or 0, rx_index + 1),
        'addizionaleComunaleCredito': ('RX3', rows['RX3_credito'] or 0, rx_index + 1),
    }
    if rn1_reference != rn1_total:
        fields['redditoRiferimentoAgevolazioni'] = ('RN1 col. 1', rn1_reference, rn_index + 1)
    return {
        'status': 'verified', 'model': 'pf', 'regime': 'irpef_ordinaria', 'parserVersion': PARSER_VERSION,
        'checks': checks, 'facts': {name: _fact(value, row, page) for name, (row, value, page) in fields.items()},
    }


def parse_pf_lm(reader):
    lm_index = None
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ''
        if 'QUADRO LM' in text and 'regime forfetario' in text.lower():
            lm_index = index
            break
    if lm_index is None:
        return {'status': 'not_applicable', 'model': 'pf'}
    if lm_index + 1 >= len(reader.pages):
        return {'status': 'review_required', 'model': 'pf', 'regime': 'forfettario', 'reason': 'lm_continuation_missing'}
    first = _fragments(reader.pages[lm_index])
    second = _fragments(reader.pages[lm_index + 1])
    rows = {
        'LM22_componenti': _value_at(first, 472.9, min_x=150),
        'LM34': _value_at(first, 304.6, min_x=150),
        'LM35': _value_at(first, 292.5, min_x=150),
        'LM36': _value_at(first, 280.5),
        'LM38': _value_at(first, 220.4),
        'LM39': _value_at(first, 196.4),
        'LM42': _value_at(second, 605.2),
        'LM43': _value_at(second, 593.1),
        'LM44': _value_at(second, 581.1),
        'LM45': _value_at(second, 569.1),
        'LM46': _value_at(second, 557.1),
        'LM47': _value_at(second, 545.0),
    }
    if rows['LM35'] is None and rows['LM34'] is not None and rows['LM34'] == rows['LM36']:
        rows['LM35'] = 0
    required = ('LM22_componenti', 'LM34', 'LM35', 'LM36', 'LM38', 'LM39', 'LM42')
    if any(rows[key] is None for key in required):
        return {'status': 'review_required', 'model': 'pf', 'regime': 'forfettario', 'reason': 'core_rows_missing', 'pages': [lm_index + 1, lm_index + 2]}
    expected_5 = round(rows['LM38'] * 0.05)
    expected_15 = round(rows['LM38'] * 0.15)
    rate = 5 if abs(rows['LM39'] - expected_5) <= 1 else 15 if abs(rows['LM39'] - expected_15) <= 1 else None
    checks = {
        'net_income': rows['LM34'] - rows['LM35'] == rows['LM36'],
        'taxable_income': rows['LM36'] == rows['LM38'],
        'substitute_tax': rate is not None,
        'tax_difference': rows['LM39'] == rows['LM42'],
    }
    if rows['LM47'] is not None and rows['LM45'] is not None:
        checks['credit_result'] = rows['LM45'] - rows['LM42'] == rows['LM47']
    if not all(checks.values()):
        return {'status': 'review_required', 'model': 'pf', 'regime': 'forfettario', 'reason': 'reconciliation_failed', 'checks': checks, 'pages': [lm_index + 1, lm_index + 2]}
    coefficient = round(rows['LM34'] / rows['LM22_componenti'] * 100, 2) if rows['LM22_componenti'] else None
    fields = {
        'ricaviCompensi': ('LM22', rows['LM22_componenti'], lm_index + 1),
        'coefficienteRedditivita': ('LM22', coefficient, lm_index + 1),
        'redditoLordo': ('LM34', rows['LM34'], lm_index + 1),
        'contributiPrevidenziali': ('LM35', rows['LM35'], lm_index + 1),
        'redditoNetto': ('LM36', rows['LM36'], lm_index + 1),
        'redditoImponibileSostitutiva': ('LM38', rows['LM38'], lm_index + 1),
        'aliquotaImpostaSostitutiva': ('LM39', rate, lm_index + 1),
        'impostaSostitutiva': ('LM39', rows['LM39'], lm_index + 1),
        'acconti': ('LM45', rows['LM45'] or 0, lm_index + 2),
        'credito': ('LM47', rows['LM47'] or 0, lm_index + 2),
    }
    return {'status': 'verified', 'model': 'pf', 'regime': 'forfettario', 'parserVersion': PARSER_VERSION, 'checks': checks, 'facts': {name: _fact(value, row, page) for name, (row, value, page) in fields.items()}}


def parse_pf_re(reader):
    re_index = None
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ''
        if re.search(r'REDDITI\s+QUADRO\s+RE\b', text, re.I) and 'lavoro autonomo' in text.lower():
            re_index = index
            break
    if re_index is None:
        return {'status': 'not_applicable', 'model': 'pf'}
    parts = _fragments(reader.pages[re_index])
    rows = {
        'RE2': _value_at(parts, 677.3),
        'RE6': _value_at(parts, 605.2),
        'RE9': _value_at(parts, 545.0),
        'RE11': _value_at(parts, 509.0),
        'RE14': _value_at(parts, 472.9),
        'RE20': _value_at(parts, 304.6),
        'RE21': _value_at(parts, 268.5),
        'RE23': _value_at(parts, 244.4),
        'RE25': _value_at(parts, 208.4),
    }
    required = ('RE6', 'RE20', 'RE21', 'RE23', 'RE25')
    if any(rows[key] is None for key in required):
        return {'status': 'review_required', 'model': 'pf', 'regime': 'professionista', 'reason': 'core_rows_missing', 'pages': [re_index + 1]}
    checks = {
        'professional_income_difference': rows['RE6'] - rows['RE20'] == rows['RE21'],
        'professional_income_total': rows['RE21'] == rows['RE23'],
        'income_to_rn': rows['RE23'] == rows['RE25'],
    }
    if not all(checks.values()):
        return {'status': 'review_required', 'model': 'pf', 'regime': 'professionista', 'reason': 'reconciliation_failed', 'checks': checks, 'pages': [re_index + 1]}
    fields = {
        'compensiProfessionali': ('RE6', rows['RE6'], re_index + 1),
        'speseProfessionali': ('RE20', rows['RE20'], re_index + 1),
        'redditoProfessionale': ('RE23', rows['RE23'], re_index + 1),
        'redditoProfessionaleRiportatoRN': ('RE25', rows['RE25'], re_index + 1),
    }
    if rows['RE2'] is not None:
        fields['compensiAttivita'] = ('RE2', rows['RE2'], re_index + 1)
    return {'status': 'verified', 'model': 'pf', 'regime': 'professionista', 'parserVersion': PARSER_VERSION, 'checks': checks, 'facts': {name: _fact(value, row, page) for name, (row, value, page) in fields.items()}}


def parse_pf_rg(reader, filing_year=2025):
    """Bluenext Redditi PF 2025, impresa in contabilita semplificata."""
    rg_index = None
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ''
        if re.search(r'REDDITI\s+QUADRO\s+RG\b', text, re.I) and 'semplificata' in text.lower():
            rg_index = index
            break
    if rg_index is None:
        return {'status': 'not_applicable', 'model': 'pf'}
    parts = _fragments(reader.pages[rg_index])
    result_coords = {
        2024: {'RG28': 172.3, 'RG31': 136.2, 'RG34': 88.1},
        2025: {'RG28': 160.3, 'RG31': 124.2, 'RG34': 52.1},
    }[filing_year]
    rows = {
        'RG2': _value_at(parts, 677.3),
        'RG3': _value_at(parts, 665.3),
        'RG12': _value_at(parts, 521.0),
        'RG15': _value_at(parts, 484.9),
        'RG18': _value_at(parts, 448.9),
        'RG22': _value_at(parts, 292.5),
        'RG24': _value_at(parts, 220.4),
        'RG25': _value_at(parts, 208.4),
        'RG28': _value_at(parts, result_coords['RG28']),
        'RG31': _value_at(parts, result_coords['RG31']),
        'RG34': _value_at(parts, result_coords['RG34']),
    }
    required = ('RG12', 'RG24', 'RG25', 'RG28', 'RG31', 'RG34')
    if any(rows[key] is None for key in required):
        return {'status': 'review_required', 'model': 'pf', 'regime': 'impresa_contabilita_semplificata', 'reason': 'core_rows_missing', 'pages': [rg_index + 1]}
    checks = {
        'components_difference': rows['RG12'] - rows['RG24'] == rows['RG25'],
        'gross_income_consistency': rows['RG25'] == rows['RG28'],
        'declared_income_consistency': rows['RG31'] == rows['RG34'],
    }
    if not all(checks.values()):
        return {'status': 'review_required', 'model': 'pf', 'regime': 'impresa_contabilita_semplificata', 'reason': 'reconciliation_failed', 'checks': checks, 'pages': [rg_index + 1]}
    fields = {
        'componentiPositivi': ('RG12', rows['RG12'], rg_index + 1),
        'componentiNegativi': ('RG24', rows['RG24'], rg_index + 1),
        'redditoImpresaLordo': ('RG28', rows['RG28'], rg_index + 1),
        'redditoImpresa': ('RG31', rows['RG31'], rg_index + 1),
        'redditoImprenditore': ('RG34', rows['RG34'], rg_index + 1),
    }
    optional = {
        'ricaviImpresa': ('RG2', rows['RG2']),
        'altriProventi': ('RG3', rows['RG3']),
        'acquistiMaterieMerci': ('RG15', rows['RG15']),
        'ammortamenti': ('RG18', rows['RG18']),
        'altriComponentiNegativi': ('RG22', rows['RG22']),
    }
    fields.update({name: (row, value, rg_index + 1) for name, (row, value) in optional.items() if value is not None})
    return {'status': 'verified', 'model': 'pf', 'regime': 'impresa_contabilita_semplificata', 'parserVersion': PARSER_VERSION, 'checks': checks, 'facts': {name: _fact(value, row, page) for name, (row, value, page) in fields.items()}}


def merge_pf_extractions(primary, tax, check_prefix='activity'):
    if primary.get('status') != 'verified' or tax.get('status') != 'verified':
        return primary
    return {
        'status': 'verified', 'model': 'pf', 'regime': primary['regime'] + '_irpef', 'parserVersion': PARSER_VERSION,
        'checks': {**{check_prefix + '_' + key: value for key, value in primary.get('checks', {}).items()}, **{'rn_' + key: value for key, value in tax.get('checks', {}).items()}},
        'facts': {**primary.get('facts', {}), **tax.get('facts', {})},
    }


def parse_sc_rf_rn_rx(reader, filing_year=2025):
    rf_index = rn_index = rx_index = None
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ''
        if rf_index is None and re.search(r'REDDITI\s+QUADRO\s+RF\b', text, re.I) and 'Determinazione del reddito di impresa' in text:
            rf_index = index
        if rn_index is None and 'QUADRO RN' in text and "determinazione dell'ires" in text.lower():
            rn_index = index
        if rx_index is None and re.search(r'REDDITI\s+QUADRO\s+RX\b', text, re.I) and 'risultato della dichiarazione' in text.lower():
            rx_index = index
    if rf_index is None or rf_index + 1 >= len(reader.pages) or rn_index is None or rx_index is None:
        return {'status': 'review_required', 'model': 'sc', 'reason': 'core_pages_missing'}
    rf_page1, rf_page2 = reader.pages[rf_index], reader.pages[rf_index + 1]
    rn_page, rx_page = reader.pages[rn_index], reader.pages[rx_index]
    if filing_year == 2024:
        rf1, rf2, rn, rx = map(_fragments, (rf_page1, rf_page2, rn_page, rx_page))
        rows = {
            'RF4': _value_at(rf1,665.5,min_x=500) or 0, 'RF5': _value_at(rf1,653.0,min_x=500) or 0,
            'RF32': _value_at(rf1,185.0,min_x=500), 'RF56': _value_at(rf2,425.5,min_x=500),
            'RF57': _value_at(rf2,413.5,min_x=500), 'RF60': _value_at(rf2,377.5,min_x=500),
            'RF63': _value_at(rf2,353.5,min_x=500), 'RN1': _value_at(rn,689.5,min_x=500),
            'RN6': _value_at(rn,533.5,min_x=500), 'RN8': _value_at(rn,497.5,min_x=500),
            'RN11': _value_at(rn,413.5,min_x=500), 'RN15': _value_at(rn,281.5,min_x=500) or 0,
            'RN16': _value_at(rn,269.5,min_x=500) or 0, 'RN17': _value_at(rn,257.5,min_x=500),
            'RN19': _value_at(rn,233.5,min_x=500) or 0, 'RN20': _value_at(rn,221.5,min_x=500) or 0,
            'RN22': _value_at(rn,185.5,min_x=250) or 0, 'RN24': _value_at(rn,125.5,min_x=500) or 0,
            'RX1_credito': _row_value(rx_page,'RX1',min_x=300),
        }
    elif filing_year == 2025:
        rf1, rf2, rn, rx = map(_fragments, (rf_page1, rf_page2, rn_page, rx_page))
        rows = {
            'RF4': _value_at(rf1,677.3) or 0, 'RF5': _value_at(rf1,665.3) or 0,
            'RF32': _value_at(rf1,196.4) or 0, 'RF56': _value_at(rf2,424.8) or 0,
            'RF57': _value_at(rf2,412.8), 'RF60': _value_at(rf2,328.6), 'RF63': _value_at(rf2,304.6),
            'RN1': _value_at(rn,689.3) or 0, 'RN6': _value_at(rn,533.0) or 0,
            'RN8': _value_at(rn,497.0) or 0, 'RN11': _value_at(rn,400.8) or 0,
            'RN15': _value_at(rn,268.5) or 0, 'RN16': _value_at(rn,256.5) or 0,
            'RN17': _value_at(rn,244.4) or 0, 'RN19': _value_at(rn,220.4) or 0,
            'RN20': _value_at(rn,208.4) or 0, 'RN22': _value_at(rn,148.3) or 0,
            'RN24': _value_at(rn,112.2) or 0, 'RX1_credito': _row_value(rx_page,'RX1',min_x=300) or 0,
        }
    else:
        rows = {
        'RF4': _row_value(rf_page1,'RF4'), 'RF32': _row_value(rf_page1,'RF32'),
        'RF56': _row_value(rf_page2,'RF56'), 'RF57': _row_value(rf_page2,'RF57'),
        'RF60': _row_value(rf_page2,'RF60'), 'RF63': _row_value(rf_page2,'RF63'),
        'RN1': _row_value(rn_page,'RN1'), 'RN6': _row_value(rn_page,'RN6'),
        'RN8': _row_value(rn_page,'RN8'), 'RN11': _row_value(rn_page,'RN11'),
        'RN15': _row_value(rn_page,'RN15'), 'RN16': _row_value(rn_page,'RN16'),
        'RN17': _row_value(rn_page,'RN17'), 'RN19': _row_value(rn_page,'RN19'),
        'RN20': _row_value(rn_page,'RN20'), 'RN22': _row_value(rn_page,'RN22'),
            'RN24': _row_value(rn_page,'RN24'), 'RX1_credito': _row_value(rx_page,'RX1',min_x=300),
        }
    required = ('RF4','RF32','RF56','RF57','RF60','RF63','RN1','RN6','RN8','RN11','RN17','RN24','RX1_credito')
    if any(rows[key] is None for key in required):
        return {'status': 'review_required', 'model': 'sc', 'regime': 'ires_ordinaria', 'reason': 'core_rows_missing', 'pages': [rf_index+1,rf_index+2,rn_index+1,rx_index+1], 'rows': rows}
    checks = {
        'taxable_income_rf': rows['RF4'] - rows.get('RF5', 0) + rows['RF32'] - rows['RF56'] == rows['RF57'],
        'income_to_rn': rows['RF57'] == rows['RF60'] == rows['RF63'] and (rows['RN1'] == rows['RF63'] if rows['RF63'] >= 0 else rows['RN1'] == 0),
        'ires_rate': abs(rows['RN8'] - round(rows['RN6'] * 0.24)) <= 1,
        'net_ires': rows['RN8'] == rows['RN11'],
        'withholding_difference': rows['RN11'] - (rows['RN16'] or 0) == rows['RN17'],
        'credit_to_rx': rows['RN24'] == rows['RX1_credito'],
    }
    if not all(checks.values()):
        return {'status': 'review_required', 'model': 'sc', 'regime': 'ires_ordinaria', 'reason': 'reconciliation_failed', 'checks': checks, 'pages': [rf_index+1,rf_index+2,rn_index+1,rx_index+1]}
    fields = {
        'utileCivilistico': ('RF4',rows['RF4'],rf_index+1), 'variazioniAumento': ('RF32',rows['RF32'],rf_index+1),
        'variazioniDiminuzione': ('RF56',rows['RF56'],rf_index+2), 'redditoFiscale': ('RF63',rows['RF63'],rf_index+2),
        'imponibileIres': ('RN6',rows['RN6'],rn_index+1), 'iresLorda': ('RN8',rows['RN8'],rn_index+1),
        'iresNetta': ('RN11',rows['RN11'],rn_index+1), 'ritenute': ('RN16',rows['RN16'] or 0,rn_index+1),
        'creditoIres': ('RN24',rows['RN24'],rn_index+1),
    }
    return {'status':'verified','model':'sc','regime':'ires_ordinaria','parserVersion':PARSER_VERSION,'checks':checks,'facts':{name:_fact(value,row,page) for name,(row,value,page) in fields.items()}}


def parse_irap_summary(reader, filing_year=2025):
    if filing_year not in {2022, 2023, 2024, 2025}:
        return {'status': 'pending_template', 'model': 'irap', 'filingYear': filing_year}
    page_index = next((i for i,p in enumerate(reader.pages) if 'QUADRO IR' in (p.extract_text() or '') and 'IR26' in (p.extract_text() or '')), None)
    if page_index is None:
        return {'status':'review_required','model':'irap','reason':'summary_page_missing'}
    parts = _fragments(reader.pages[page_index])
    base = _value_at(parts,689.0,min_x=100)
    debit_y = 173.0 if filing_year == 2022 else 161.0
    tax_y = 305.0 if filing_year == 2022 else 281.0
    total_tax = _value_at(parts,tax_y,min_x=500) or 0
    debit = _value_at(parts,debit_y,min_x=500) or 0
    credit = _value_at(parts,debit_y-24.0,min_x=500) or 0
    if base is None or (debit == 0 and credit == 0):
        return {'status':'review_required','model':'irap','reason':'core_rows_missing','page':page_index+1}
    expected = round(base * 0.039)
    checks = {'standard_rate': abs(total_tax-expected) <= 1, 'exclusive_balance': not (debit and credit)}
    if not all(checks.values()):
        return {'status':'review_required','model':'irap','reason':'reconciliation_failed','checks':checks,'page':page_index+1,'rows':{'IR1':base,'IR21':total_tax,'IR26':debit,'IR27':credit,'expectedStandardTax':expected}}
    return {'status':'verified','model':'irap','parserVersion':PARSER_VERSION,'checks':checks,'facts':{
        'baseImponibileIrap':_fact(base,'IR1',page_index+1), 'irapTotale':_fact(total_tax,'IR21',page_index+1), 'irapDebito':_fact(debit,'IR26',page_index+1), 'irapCredito':_fact(credit,'IR27',page_index+1)}}


def parse_iva_summary(reader, filing_year=2025):
    if filing_year not in {2022, 2023, 2024, 2025}:
        return {'status': 'pending_template', 'model': 'iva', 'filingYear': filing_year}
    ve_index = next((i for i,p in enumerate(reader.pages) if 'QUADRO VE' in (p.extract_text() or '') and 'VE50' in (p.extract_text() or '')), None)
    vl_index = next((i for i,p in enumerate(reader.pages) if 'QUADRO VL' in (p.extract_text() or '') and 'VL32' in (p.extract_text() or '')), None)
    if ve_index is None or vl_index is None:
        return {'status':'review_required','model':'iva','reason':'summary_pages_missing'}
    ve, vl = _fragments(reader.pages[ve_index]), _fragments(reader.pages[vl_index])
    volume = _value_at(ve,161.5,min_x=350)
    debit_y = 293.5 if filing_year in {2022, 2023} else 269.5
    balance_y = 221.5 if filing_year in {2022, 2023} else 197.5
    debit = _value_at(vl,debit_y,min_x=500) or 0
    credit = _value_at(vl,debit_y-24.0,min_x=500) or 0
    balance = _value_at(vl,balance_y,min_x=500) or 0
    checks = {'exclusive_balance': not (debit and credit), 'balance_repeated': max(debit,credit) == balance}
    if volume is None or not all(checks.values()):
        return {'status':'review_required','model':'iva','reason':'reconciliation_failed','checks':checks,'pages':[ve_index+1,vl_index+1]}
    return {'status':'verified','model':'iva','parserVersion':PARSER_VERSION,'checks':checks,'facts':{
        'volumeAffari':_fact(volume,'VE50',ve_index+1), 'ivaDebito':_fact(debit,'VL32',vl_index+1), 'ivaCredito':_fact(credit,'VL33',vl_index+1)}}


def parse(reader, model, filing_year=2025):
    if model == 'pf':
        lm = parse_pf_lm(reader)
        if lm.get('status') != 'not_applicable':
            return lm
        professional = parse_pf_re(reader)
        business = parse_pf_rg(reader, filing_year)
        tax = parse_pf_rn_rx(reader, filing_year)
        if professional.get('status') != 'not_applicable':
            return merge_pf_extractions(professional, tax, 're')
        if business.get('status') != 'not_applicable':
            return merge_pf_extractions(business, tax, 'rg')
        return tax
    if model == 'sp':
        return parse_sp_rg(reader)
    if model == 'sc':
        return parse_sc_rf_rn_rx(reader, filing_year)
    return {'status': 'pending_template', 'model': model}
