"""Cessioni ordinarie di piena proprietà: importi in centesimi, nessuna inferenza di accordi."""
import copy
import re
import json
from pathlib import Path
from datetime import date
from decimal import Decimal, InvalidOperation

CLAUSE_DEFAULTS = json.loads(Path(__file__).with_name('clause-defaults.json').read_text(encoding='utf-8'))


def money(value):
    value = str(value or '').strip().replace(' ', '')
    if ',' in value:
        value = value.replace('.', '').replace(',', '.')
    if not re.fullmatch(r'\d+(?:\.\d{1,2})?', value):
        raise ValueError('Importo non valido: usare al massimo due decimali')
    n = Decimal(value) * 100
    if n > 10**14:
        raise ValueError('Importo fuori limite')
    return int(n)


def euro(cents):
    return ('-' if cents < 0 else '') + f'{abs(cents)//100:,}'.replace(',', '.') + ',' + f'{abs(cents)%100:02d}'


def percent(cents, capital):
    return str((Decimal(cents) * 100 / Decimal(capital)).quantize(Decimal('.0001'))).rstrip('0').rstrip('.').replace('.', ',') if capital else '?'


def blank():
    return {'company': {'name': '', 'taxCode': '', 'address': '', 'rea': '', 'register': '', 'capital': '', 'paidCapital': '', 'reportDate': ''},
            'parties': [], 'transfers': [], 'sources': [], 'date': '', 'place': '', 'professional': '',
            'preemption': '', 'warranties': '', 'effects': '', 'taxClause': '', 'expenses': '',
            'extra': '', 'checks': {}, **CLAUSE_DEFAULTS, 'clauseDefaultsVersion': 1}


def check(data, final=False):
    errors = []
    c = data.get('company', {})
    def required(obj, keys, label):
        for key in keys:
            if not str(obj.get(key, '')).strip():
                errors.append(f'{label}: manca {key}')
    required(c, ['name', 'taxCode', 'address', 'rea', 'register', 'capital'], 'Società')
    try:
        capital = money(c.get('capital'))
        if not capital:
            raise ValueError()
    except ValueError:
        capital = 0
        errors.append('Capitale sociale non valido')
    parties = data.get('parties', [])
    ids = [p.get('id') for p in parties]
    if len(ids) != len(set(ids)) or any(not x for x in ids):
        errors.append('Identificativi delle parti duplicati o mancanti')
    fiscal = [str(p.get('taxCode', '')).strip().upper() for p in parties]
    if len(fiscal) != len(set(fiscal)):
        errors.append('La stessa parte compare più volte: unificare le schede per codice fiscale')
    before = {}
    for p in parties:
        required(p, ['name', 'taxCode'], 'Socio / parte')
        try:
            before[p.get('id')] = money(p.get('holding', '0'))
        except ValueError:
            errors.append(f"Quota iniziale non valida: {p.get('name')}")
    if sum(before.values()) != capital:
        errors.append('La somma delle quote iniziali deve coincidere con il capitale sociale')
    after = before.copy()
    outgoing = {}
    transfers = data.get('transfers', [])
    if not transfers:
        errors.append('Inserire almeno una cessione')
    participants = set()
    for i, t in enumerate(transfers):
        s, b = t.get('seller'), t.get('buyer')
        participants.update([s, b])
        if s not in before or b not in before or s == b:
            errors.append(f'Cessione {i+1}: selezionare cedente e cessionario distinti')
            continue
        try:
            n, price = money(t.get('nominal')), money(t.get('price'))
            if n <= 0 or price <= 0:
                raise ValueError()
        except ValueError:
            errors.append(f'Cessione {i+1}: nominale e prezzo devono essere positivi')
            continue
        outgoing[s] = outgoing.get(s, 0) + n
        after[s] -= n
        after[b] += n
        if not t.get('payment', '').strip():
            errors.append(f'Cessione {i+1}: indicare modalità e termini del pagamento')
        if t.get('paid') and not t.get('receipt', '').strip():
            errors.append(f'Cessione {i+1}: indicare il riscontro del pagamento per la quietanza')
    for pid, amount in outgoing.items():
        if amount > before[pid]:
            errors.append('Le cessioni complessive superano la quota iniziale del cedente')
    if final:
        if not re.fullmatch(r'\d{11}', str(c.get('taxCode', ''))):
            errors.append('Codice fiscale della società: richieste 11 cifre')
        required(data, ['date', 'place', 'professional', 'preemption', 'warranties', 'effects', 'taxClause', 'expenses'], 'Atto')
        try:
            date.fromisoformat(data.get('date', ''))
        except ValueError:
            errors.append('Data atto non valida')
        for p in parties:
            if p.get('right') and str(p['right']).lower() not in ('ownership', 'proprietà', 'proprieta', 'piena proprietà'):
                errors.append('Diritto diverso dalla piena proprietà: caso non supportato dal modello ordinario')
            if p.get('id') not in participants:
                continue
            required(p, ['address', 'identityEvidence'], p.get('name', 'Parte'))
            if p.get('kind') == 'company':
                required(p, ['representative', 'representativeTaxCode', 'representativeBirth', 'representativeAddress', 'powers'], p.get('name', 'Società contraente'))
            elif p.get('kind') == 'person':
                required(p, ['birthDate', 'birthPlace'], p.get('name', 'Persona'))
            else:
                errors.append('Specificare persona fisica o società per ogni contraente')
            pattern = r'\d{11}' if p.get('kind') == 'company' else r'[A-Z0-9]{16}'
            if not re.fullmatch(pattern, str(p.get('taxCode', '')).upper()):
                errors.append(f"Codice fiscale non valido: {p.get('name')}")
        for key, label in [('identity', 'Identità e poteri dei firmatari'), ('ownership', 'Titolarità, quote e attualità della compagine'), ('statute', 'Statuto, prelazione e gradimento'), ('terms', 'Prezzi, pagamenti e clausole'), ('review', 'Revisione del testo definitivo')]:
            if data.get('checks', {}).get(key) is not True:
                errors.append(f'Conferma richiesta: {label}')
        if '[' in '\n'.join(text for _, text in paragraphs(data)):
            errors.append('Eliminare i segnaposto tra parentesi quadre prima del definitivo')
    return {'errors': list(dict.fromkeys(errors)), 'before': before, 'after': after, 'capital': capital,
            'soleMember': next((p.get('name') for p in parties if capital and after.get(p.get('id')) == capital), None)}


def val(obj, key):
    return str(obj.get(key) or f'[{key}]')


def identity(p):
    if p.get('kind') == 'company':
        return (f"{val(p, 'name')}, con sede in {val(p, 'address')}, codice fiscale {val(p, 'taxCode')}, "
                f"in persona di {val(p, 'representative')}, codice fiscale {val(p, 'representativeTaxCode')}, "
                f"{val(p, 'representativeBirth')}, residente in {val(p, 'representativeAddress')}, "
                f"che interviene nella propria qualità di {val(p, 'powers')}")
    return f"{val(p, 'name')}, nato/a a {val(p, 'birthPlace')} il {val(p, 'birthDate')}, residente in {val(p, 'address')}, codice fiscale {val(p, 'taxCode')}"


def paragraphs(d):
    c = d.get('company', {})
    ps = {p['id']: p for p in d.get('parties', [])}
    ts = d.get('transfers', [])
    single = len(ts) == 1
    def clause(key):
        text = val(d, key)
        # Adapt only the untouched model; never rewrite negotiated custom text.
        if text != CLAUSE_DEFAULTS.get(key):
            return text
        if key == 'effects' and single:
            return text.replace('Gli effetti delle cessioni', 'Gli effetti della cessione').replace('le cessioni che precedono saranno annotate', 'la cessione che precede sarà annotata')
        if key == 'ownershipIntro' and not single:
            return text.replace('della presente cessione', 'delle presenti cessioni')
        return text
    result = [('title', 'Cessione di quote societarie'), ('body', 'Con la presente scrittura privata intervengono:')]
    sellers = {t.get('seller') for t in ts}
    buyers = {t.get('buyer') for t in ts}
    for pid, p in ps.items():
        roles = []
        if pid in sellers: roles.append('cedente')
        if pid in buyers: roles.append('cessionario')
        if roles: result.append(('body', identity(p) + ' (' + ' e '.join(roles) + ').'))
    result += [('heading', 'Premesse'), ('premise', f"La società {val(c, 'name')}, con sede in {val(c, 'address')}, codice fiscale {val(c, 'taxCode')}, iscritta al Registro delle Imprese di {val(c, 'register')}, REA {val(c, 'rea')}, ha capitale sociale di euro {val(c, 'capital')}; capitale versato: euro {val(c, 'paidCapital')}."), ('premise', 'Il capitale sociale prima della cessione è così ripartito:' if single else 'Il capitale sociale prima delle cessioni è così ripartito:')]
    try: cap = money(c.get('capital'))
    except ValueError: cap = 0
    balances = {}
    for pid, p in ps.items():
        try: n = money(p.get('holding', '0'))
        except ValueError: n = 0
        balances[pid] = n
        if n: result.append(('share', f"{val(p, 'name')}: euro {euro(n)}, pari al {percent(n, cap)}%."))
    result += [('premise', val(d, 'preemption')), ('body', 'Tutto ciò premesso, le parti convengono e stipulano quanto segue.'), ('heading', 'Articolo 1 Premesse'), ('body', 'Le premesse formano parte integrante e sostanziale della presente scrittura privata.'), ('heading', 'Articolo 2 Cessione e corrispettivo' if single else 'Articolo 2 Cessioni e corrispettivi')]
    for i, t in enumerate(ts):
        s, b = ps.get(t.get('seller'), {}), ps.get(t.get('buyer'), {})
        try: n = money(t.get('nominal'))
        except ValueError: n = 0
        result.append(('body', ('' if single else f"Cessione {i+1}. ") + f"{val(s, 'name')} cede e trasferisce a {val(b, 'name')}, che accetta e acquista, una quota di {val(c, 'name')} di nominali euro {val(t, 'nominal')}, pari al {percent(n, cap)}% del capitale sociale, per il prezzo convenuto di euro {val(t, 'price')}. {val(t, 'payment')}"))
        if t.get('paid'): result.append(('body', 'Il cedente dichiara di aver ricevuto il corrispettivo e ne rilascia quietanza.'))
        if t.get('seller') in balances and t.get('buyer') in balances:
            balances[t['seller']] -= n
            balances[t['buyer']] += n
    result += [('heading', 'Articolo 3 Diritti inerenti alla quota' if single else 'Articolo 3 Diritti inerenti alle quote'), ('body', ('La quota è trasferita' if single else 'Le quote sono trasferite') + ' con i diritti e gli obblighi inerenti alla partecipazione, in conformità alla legge e allo statuto sociale.'), ('heading', 'Articolo 4 Dichiarazioni e garanzie'), ('body', clause('warranties')), ('heading', 'Articolo 5 Compagine risultante')]
    if d.get('ownershipIntro'):
        result.append(('body', clause('ownershipIntro')))
    for pid, n in balances.items():
        if n: result.append(('body', f"{val(ps[pid], 'name')}: euro {euro(n)}, pari al {percent(n, cap)}%."))
    result += [('heading', 'Articolo 6 Disciplina fiscale'), ('body', clause('taxClause')), ('heading', 'Articolo 7 Effetti e adempimenti'), ('body', clause('effects')), ('heading', 'Articolo 8 Spese'), ('body', clause('expenses')), ('heading', 'Articolo 9 Professionista incaricato'), ('body', f"Le parti incaricano {val(d, 'professional')} degli adempimenti di registrazione e deposito dell'atto sottoscritto digitalmente e assoggettato a marcatura temporale, secondo la disciplina applicabile.")]
    if d.get('extra'): result += [('heading', 'Ulteriori pattuizioni'), ('body', d['extra'])]
    raw_date = val(d, 'date')
    try: raw_date = date.fromisoformat(raw_date).strftime('%d/%m/%Y')
    except ValueError: pass
    result.append(('body', f"{val(d, 'place')}, {raw_date}"))
    for pid, p in ps.items():
        if pid in sellers | buyers:
            result.append(('signature', f"{val(p, 'name')}" + (f" — {val(p, 'representative')}" if p.get('kind') == 'company' else '')))
    result.append(('signature', val(d, 'professional')))
    return result
