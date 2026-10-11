<?php
declare(strict_types=1);

function getDb(string $path): PDO {
    $db = new PDO('sqlite:' . $path);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec('PRAGMA busy_timeout = 10000');
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec('PRAGMA journal_mode = WAL');
    return $db;
}

function initRelationalSchema(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        vat TEXT,
        cf TEXT NOT NULL,
        address TEXT NOT NULL,
        zip TEXT NOT NULL,
        city TEXT NOT NULL,
        province TEXT NOT NULL,
        sdi TEXT,
        pec TEXT,
        email TEXT,
        delivery_channel TEXT,
        dossier_id TEXT,
        months INTEGER NOT NULL DEFAULT 3,
        next_date TEXT NOT NULL,
        anchor INTEGER NOT NULL DEFAULT 1,
        days INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        vat_rate REAL NOT NULL DEFAULT 22,
        fund_rate REAL NOT NULL DEFAULT 4,
        withholding_rate REAL NOT NULL DEFAULT 20,
        stamp REAL NOT NULL DEFAULT 0,
        nature TEXT NOT NULL DEFAULT \'N2.2\',
        lines_json TEXT NOT NULL
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS notices (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL REFERENCES clients(id),
        date TEXT NOT NULL,
        due TEXT NOT NULL,
        period_json TEXT,
        service_description TEXT,
        note TEXT,
        recurrence_key TEXT,
        cancelled INTEGER NOT NULL DEFAULT 0,
        vat_rate REAL NOT NULL,
        fund_rate REAL NOT NULL,
        withholding_rate REAL NOT NULL,
        stamp REAL NOT NULL,
        nature TEXT NOT NULL,
        totals_base INTEGER NOT NULL,
        totals_fund INTEGER NOT NULL,
        totals_vat INTEGER NOT NULL,
        totals_withholding INTEGER NOT NULL,
        totals_stamp INTEGER NOT NULL,
        totals_gross INTEGER NOT NULL,
        totals_net INTEGER NOT NULL,
        sent_email_json TEXT,
        created_at TEXT NOT NULL
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS notice_lines (
        id TEXT PRIMARY KEY,
        notice_id TEXT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        quantity_cents INTEGER NOT NULL,
        basis TEXT NOT NULL DEFAULT \'item\'
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        notice_id TEXT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        reference TEXT,
        invoice_id TEXT,
        created_at TEXT NOT NULL
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        notice_id TEXT NOT NULL REFERENCES notices(id),
        payment_id TEXT,
        date TEXT NOT NULL,
        payment_date TEXT,
        status TEXT NOT NULL DEFAULT \'da_inviare\',
        transmission_reference TEXT,
        filename TEXT NOT NULL,
        xml_hash_sha256 TEXT NOT NULL,
        xml_content TEXT NOT NULL,
        totals_base INTEGER NOT NULL,
        totals_fund INTEGER NOT NULL,
        totals_vat INTEGER NOT NULL,
        totals_withholding INTEGER NOT NULL,
        totals_stamp INTEGER NOT NULL,
        totals_gross INTEGER NOT NULL,
        totals_net INTEGER NOT NULL,
        lines_json TEXT NOT NULL,
        rates_json TEXT NOT NULL,
        created_at TEXT NOT NULL
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS service_rates (
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        last_number INTEGER NOT NULL
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        actor TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
    )');

    // Tables for Registro Adempimenti
    $db->exec('CREATE TABLE IF NOT EXISTS adempimenti_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        normalized_name TEXT NOT NULL,
        vat TEXT,
        cf TEXT,
        created_at TEXT NOT NULL
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS adempimenti_cells (
        id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        raw_text TEXT NOT NULL DEFAULT \'\',
        parsed_json TEXT NOT NULL DEFAULT \'[]\',
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        UNIQUE(client_name, year, month)
    )');

    // Indices for high-frequency queries
    $db->exec('CREATE INDEX IF NOT EXISTS idx_notices_client ON notices(client_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_notice_lines_notice ON notice_lines(notice_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_payments_notice ON payments(notice_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_invoices_notice ON invoices(notice_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_adempimenti_cells_year ON adempimenti_cells(year)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_adempimenti_cells_client ON adempimenti_cells(client_name)');

    // Ensure sent_email_json exists in notices for upgraded databases
    try {
        $cols = $db->query('PRAGMA table_info(notices)')->fetchAll(PDO::FETCH_ASSOC);
        $names = array_column($cols, 'name');
        if (!empty($names) && !in_array('sent_email_json', $names, true)) {
            $db->exec('ALTER TABLE notices ADD COLUMN sent_email_json TEXT');
        }
    } catch (Throwable) {}
}

function checkAndMigrateLegacy(PDO $db): void {
    initRelationalSchema($db);

    // Check if schema_version exists in meta
    $q = $db->query('SELECT value FROM meta WHERE key = "schema_version"');
    $version = $q ? $q->fetchColumn() : false;
    if ($version !== false) {
        return; // already migrated
    }

    // Check if legacy table 'state' exists
    $tableCheck = $db->query('SELECT name FROM sqlite_master WHERE type="table" AND name="state"')->fetchColumn();
    if ($tableCheck) {
        $legacyPayload = $db->query('SELECT payload FROM state WHERE id = 1')->fetchColumn();
        if ($legacyPayload) {
            $s = json_decode((string)$legacyPayload, true);
            if (is_array($s)) {
                $db->beginTransaction();
                try {
                    // 1. Meta
                    $revision = (int)($s['revision'] ?? 0);
                    $stmt = $db->prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
                    $stmt->execute(['schema_version', '2']);
                    $stmt->execute(['revision', (string)$revision]);
                    $stmt->execute(['studio_json', json_encode($s['studio'] ?? [])]);

                    // 2. Service rates
                    $stmtSR = $db->prepare('INSERT OR REPLACE INTO service_rates (key, kind, description, amount_cents, position) VALUES (?, ?, ?, ?, ?)');
                    foreach (($s['serviceRates'] ?? []) as $pos => $sr) {
                        $stmtSR->execute([
                            $sr['key'] ?? ('sr_' . $pos),
                            $sr['kind'] ?? 'custom',
                            $sr['description'] ?? '',
                            (int)round(((float)($sr['amount'] ?? 0)) * 100),
                            $pos
                        ]);
                    }

                    // 3. Counters
                    $stmtC = $db->prepare('INSERT OR REPLACE INTO counters (name, last_number) VALUES (?, ?)');
                    foreach (($s['counters'] ?? []) as $name => $last) {
                        $stmtC->execute([(string)$name, (int)$last]);
                    }

                    // 4. Clients
                    $stmtCl = $db->prepare('INSERT OR REPLACE INTO clients (id, name, vat, cf, address, zip, city, province, sdi, pec, email, delivery_channel, dossier_id, months, next_date, anchor, days, active, vat_rate, fund_rate, withholding_rate, stamp, nature, lines_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                    foreach (($s['clients'] ?? []) as $c) {
                        $stmtCl->execute([
                            $c['id'],
                            $c['name'] ?? '',
                            $c['vat'] ?? '',
                            $c['cf'] ?? '',
                            $c['address'] ?? '',
                            $c['zip'] ?? '',
                            $c['city'] ?? '',
                            $c['province'] ?? '',
                            $c['sdi'] ?? '',
                            $c['pec'] ?? '',
                            $c['email'] ?? '',
                            $c['deliveryChannel'] ?? '',
                            $c['dossierId'] ?? '',
                            (int)($c['months'] ?? 3),
                            $c['nextDate'] ?? date('Y-m-d'),
                            (int)($c['anchor'] ?? 1),
                            (int)($c['days'] ?? 0),
                            !empty($c['active']) ? 1 : 0,
                            (float)($c['vatRate'] ?? 22),
                            (float)($c['fundRate'] ?? 4),
                            (float)($c['withholdingRate'] ?? 20),
                            (float)($c['stamp'] ?? 0),
                            $c['nature'] ?? 'N2.2',
                            json_encode($c['lines'] ?? [])
                        ]);
                    }

                    // 5. Notices, lines, payments
                    $stmtN = $db->prepare('INSERT OR REPLACE INTO notices (id, number, client_id, date, due, period_json, service_description, note, recurrence_key, cancelled, vat_rate, fund_rate, withholding_rate, stamp, nature, totals_base, totals_fund, totals_vat, totals_withholding, totals_stamp, totals_gross, totals_net, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                    $stmtNL = $db->prepare('INSERT OR REPLACE INTO notice_lines (id, notice_id, position, description, amount_cents, quantity_cents, basis) VALUES (?, ?, ?, ?, ?, ?, ?)');
                    $stmtP = $db->prepare('INSERT OR REPLACE INTO payments (id, notice_id, date, amount_cents, reference, invoice_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');

                    foreach (($s['notices'] ?? []) as $n) {
                        $tot = $n['totals'] ?? [];
                        $rt = $n['rates'] ?? [];
                        $stmtN->execute([
                            $n['id'],
                            $n['number'],
                            $n['clientId'],
                            $n['date'],
                            $n['due'],
                            !empty($n['period']) ? json_encode($n['period']) : null,
                            $n['serviceDescription'] ?? '',
                            $n['note'] ?? '',
                            $n['recurrenceKey'] ?? '',
                            !empty($n['cancelled']) ? 1 : 0,
                            (float)($rt['vatRate'] ?? 22),
                            (float)($rt['fundRate'] ?? 4),
                            (float)($rt['withholdingRate'] ?? 20),
                            (float)($rt['stamp'] ?? 0),
                            $rt['nature'] ?? 'N2.2',
                            (int)($tot['base'] ?? 0),
                            (int)($tot['fund'] ?? 0),
                            (int)($tot['vat'] ?? 0),
                            (int)($tot['withholding'] ?? 0),
                            (int)($tot['stamp'] ?? 0),
                            (int)($tot['gross'] ?? 0),
                            (int)($tot['net'] ?? 0),
                            $n['date'] . 'T00:00:00Z'
                        ]);

                        foreach (($n['lines'] ?? []) as $idx => $line) {
                            $stmtNL->execute([
                                $n['id'] . '_l_' . $idx,
                                $n['id'],
                                $idx,
                                $line['description'] ?? '',
                                (int)round(((float)($line['amount'] ?? 0)) * 100),
                                (int)round(((float)($line['quantity'] ?? 1)) * 100),
                                $line['basis'] ?? 'item'
                            ]);
                        }

                        foreach (($n['payments'] ?? []) as $pm) {
                            $stmtP->execute([
                                $pm['id'],
                                $n['id'],
                                $pm['date'],
                                (int)($pm['amount'] ?? 0),
                                $pm['reference'] ?? '',
                                $pm['invoiceId'] ?? null,
                                $pm['date'] . 'T00:00:00Z'
                            ]);
                        }
                    }

                    // 6. Invoices
                    $stmtInv = $db->prepare('INSERT OR REPLACE INTO invoices (id, number, notice_id, payment_id, date, payment_date, status, transmission_reference, filename, xml_hash_sha256, xml_content, totals_base, totals_fund, totals_vat, totals_withholding, totals_stamp, totals_gross, totals_net, lines_json, rates_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                    foreach (($s['invoices'] ?? []) as $inv) {
                        $tot = $inv['totals'] ?? [];
                        $xml = $inv['xml'] ?? '';
                        $hash = $inv['sha256'] ?? ($xml ? hash('sha256', $xml) : '');
                        $stmtInv->execute([
                            $inv['id'],
                            $inv['number'],
                            $inv['noticeId'] ?? '',
                            $inv['paymentId'] ?? null,
                            $inv['date'],
                            $inv['paymentDate'] ?? $inv['date'],
                            $inv['status'] ?? 'da_inviare',
                            $inv['transmissionReference'] ?? '',
                            $inv['filename'] ?? '',
                            $hash,
                            $xml,
                            (int)($tot['base'] ?? 0),
                            (int)($tot['fund'] ?? 0),
                            (int)($tot['vat'] ?? 0),
                            (int)($tot['withholding'] ?? 0),
                            (int)($tot['stamp'] ?? 0),
                            (int)($tot['gross'] ?? 0),
                            (int)($tot['net'] ?? 0),
                            json_encode($inv['lines'] ?? []),
                            json_encode($inv['rates'] ?? []),
                            $inv['date'] . 'T00:00:00Z'
                        ]);
                    }

                    // Backup legacy state table
                    $db->exec('ALTER TABLE state RENAME TO state_legacy_backup');
                    $db->commit();
                    return;
                } catch (Throwable $e) {
                    $db->rollBack();
                    throw $e;
                }
            }
        }
    }

    // If completely new DB
    $init = initialState();
    $db->beginTransaction();
    $stmt = $db->prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    $stmt->execute(['schema_version', '2']);
    $stmt->execute(['revision', '0']);
    $stmt->execute(['studio_json', json_encode($init['studio'])]);

    $stmtSR = $db->prepare('INSERT OR REPLACE INTO service_rates (key, kind, description, amount_cents, position) VALUES (?, ?, ?, ?, ?)');
    foreach ($init['serviceRates'] as $pos => $sr) {
        $stmtSR->execute([$sr['key'], $sr['kind'], $sr['description'], (int)round($sr['amount'] * 100), $pos]);
    }
    $db->commit();
}

function loadStateFromDb(PDO $db, bool $includeXml = false): array {
    // 1. Meta
    $metaRows = $db->query('SELECT key, value FROM meta')->fetchAll(PDO::FETCH_KEY_PAIR);
    $revision = (int)($metaRows['revision'] ?? 0);
    $studio = json_decode($metaRows['studio_json'] ?? '{}', true) ?: initialState()['studio'];

    // 2. Service rates
    $srRows = $db->query('SELECT key, kind, description, amount_cents FROM service_rates ORDER BY position ASC, rowid ASC')->fetchAll(PDO::FETCH_ASSOC);
    $serviceRates = array_map(fn($r) => [
        'key' => $r['key'],
        'kind' => $r['kind'],
        'description' => $r['description'],
        'amount' => (float)($r['amount_cents'] / 100)
    ], $srRows);
    if (empty($serviceRates)) $serviceRates = defaultServiceRates();

    // 3. Counters
    $cRows = $db->query('SELECT name, last_number FROM counters')->fetchAll(PDO::FETCH_ASSOC);
    $counters = [];
    foreach ($cRows as $cr) {
        $counters[$cr['name']] = (int)$cr['last_number'];
    }

    // 4. Clients
    $clRows = $db->query('SELECT * FROM clients ORDER BY rowid ASC')->fetchAll(PDO::FETCH_ASSOC);
    $clients = [];
    foreach ($clRows as $r) {
        $clients[$r['id']] = [
            'id' => $r['id'],
            'name' => $r['name'],
            'vat' => $r['vat'] ?? '',
            'cf' => $r['cf'],
            'address' => $r['address'],
            'zip' => $r['zip'],
            'city' => $r['city'],
            'province' => $r['province'],
            'sdi' => $r['sdi'] ?? '',
            'pec' => $r['pec'] ?? '',
            'email' => $r['email'] ?? '',
            'deliveryChannel' => $r['delivery_channel'] ?? '',
            'dossierId' => $r['dossier_id'] ?? '',
            'months' => (int)$r['months'],
            'nextDate' => $r['next_date'],
            'anchor' => (int)$r['anchor'],
            'days' => (int)$r['days'],
            'active' => (bool)$r['active'],
            'vatRate' => (float)$r['vat_rate'],
            'fundRate' => (float)$r['fund_rate'],
            'withholdingRate' => (float)$r['withholding_rate'],
            'stamp' => (float)$r['stamp'],
            'nature' => $r['nature'],
            'lines' => json_decode($r['lines_json'] ?? '[]', true) ?: []
        ];
    }

    // 5. Invoices map
    $invSql = $includeXml 
        ? 'SELECT * FROM invoices ORDER BY rowid ASC'
        : 'SELECT id, number, notice_id, payment_id, date, payment_date, status, transmission_reference, filename, xml_hash_sha256, totals_base, totals_fund, totals_vat, totals_withholding, totals_stamp, totals_gross, totals_net, lines_json, rates_json FROM invoices ORDER BY rowid ASC';
    $invRows = $db->query($invSql)->fetchAll(PDO::FETCH_ASSOC);
    $invoices = [];
    $noticeInvoiceMap = [];
    foreach ($invRows as $ir) {
        $invoices[$ir['id']] = [
            'id' => $ir['id'],
            'number' => $ir['number'],
            'noticeId' => $ir['notice_id'],
            'paymentId' => $ir['payment_id'] ?? '',
            'date' => $ir['date'],
            'paymentDate' => $ir['payment_date'] ?? $ir['date'],
            'status' => $ir['status'],
            'transmissionReference' => $ir['transmission_reference'] ?? '',
            'filename' => $ir['filename'],
            'sha256' => $ir['xml_hash_sha256'],
            'client' => $clients[$ir['notice_id']] ?? ($studio), // populated later if needed
            'studio' => $studio,
            'totals' => [
                'base' => (int)$ir['totals_base'],
                'fund' => (int)$ir['totals_fund'],
                'vat' => (int)$ir['totals_vat'],
                'withholding' => (int)$ir['totals_withholding'],
                'stamp' => (int)$ir['totals_stamp'],
                'gross' => (int)$ir['totals_gross'],
                'net' => (int)$ir['totals_net']
            ],
            'lines' => json_decode($ir['lines_json'] ?? '[]', true) ?: [],
            'rates' => json_decode($ir['rates_json'] ?? '{}', true) ?: []
        ];
        if ($includeXml && isset($ir['xml_content'])) {
            $invoices[$ir['id']]['xml'] = $ir['xml_content'];
        }
        $noticeInvoiceMap[$ir['notice_id']][] = $ir['id'];
    }

    // 6. Notices, lines, payments
    $nRows = $db->query('SELECT * FROM notices ORDER BY rowid ASC')->fetchAll(PDO::FETCH_ASSOC);
    $nlRows = $db->query('SELECT * FROM notice_lines ORDER BY position ASC, rowid ASC')->fetchAll(PDO::FETCH_ASSOC);
    $linesByNotice = [];
    foreach ($nlRows as $nl) {
        $linesByNotice[$nl['notice_id']][] = [
            'description' => $nl['description'],
            'amount' => (float)($nl['amount_cents'] / 100),
            'quantity' => (float)($nl['quantity_cents'] / 100),
            'basis' => $nl['basis']
        ];
    }

    $pmRows = $db->query('SELECT * FROM payments ORDER BY date ASC, rowid ASC')->fetchAll(PDO::FETCH_ASSOC);
    $paymentsByNotice = [];
    foreach ($pmRows as $pm) {
        $paymentsByNotice[$pm['notice_id']][] = [
            'id' => $pm['id'],
            'date' => $pm['date'],
            'amount' => (int)$pm['amount_cents'],
            'reference' => $pm['reference'] ?? '',
            'invoiceId' => $pm['invoice_id'] ?? ''
        ];
    }

    $notices = [];
    foreach ($nRows as $nr) {
        $nid = $nr['id'];
        $invIds = $noticeInvoiceMap[$nid] ?? [];
        $notices[$nid] = [
            'id' => $nid,
            'number' => $nr['number'],
            'clientId' => $nr['client_id'],
            'client' => $clients[$nr['client_id']] ?? ['name' => 'Cliente non trovato'],
            'studio' => $studio,
            'date' => $nr['date'],
            'due' => $nr['due'],
            'period' => $nr['period_json'] ? json_decode($nr['period_json'], true) : null,
            'serviceDescription' => $nr['service_description'] ?? '',
            'note' => $nr['note'] ?? '',
            'recurrenceKey' => $nr['recurrence_key'] ?? '',
            'cancelled' => (bool)$nr['cancelled'],
            'rates' => [
                'vatRate' => (float)$nr['vat_rate'],
                'fundRate' => (float)$nr['fund_rate'],
                'withholdingRate' => (float)$nr['withholding_rate'],
                'stamp' => (float)$nr['stamp'],
                'nature' => $nr['nature']
            ],
            'totals' => [
                'base' => (int)$nr['totals_base'],
                'fund' => (int)$nr['totals_fund'],
                'vat' => (int)$nr['totals_vat'],
                'withholding' => (int)$nr['totals_withholding'],
                'stamp' => (int)$nr['totals_stamp'],
                'gross' => (int)$nr['totals_gross'],
                'net' => (int)$nr['totals_net']
            ],
            'lines' => $linesByNotice[$nid] ?? [],
            'payments' => $paymentsByNotice[$nid] ?? [],
            'invoiceIds' => $invIds,
            'invoiceId' => !empty($invIds) ? end($invIds) : '',
            'sentEmail' => !empty($nr['sent_email_json']) ? json_decode($nr['sent_email_json'], true) : null
        ];
    }

    // Set invoice client accurately
    foreach ($invoices as &$inv) {
        $nid = $inv['noticeId'];
        if (isset($notices[$nid])) {
            $inv['client'] = $notices[$nid]['client'];
            $inv['noticeNumber'] = $notices[$nid]['number'];
        }
    }
    unset($inv);

    return [
        'revision' => $revision,
        'studio' => $studio,
        'serviceRates' => $serviceRates,
        'clients' => $clients,
        'notices' => $notices,
        'invoices' => $invoices,
        'counters' => $counters,
        'audit' => []
    ];
}

function persistDiffToDb(PDO $db, array $oldState, array $newState, string $op, string $actor): void {
    // 1. Revision & Meta
    $stmtMeta = $db->prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    $stmtMeta->execute(['revision', (string)$newState['revision']]);

    $stmtAudit = $db->prepare('INSERT INTO audit_log (entity, entity_id, operation, actor, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $now = date(DATE_ATOM);

    // Studio change
    if ($oldState['studio'] != $newState['studio']) {
        $stmtMeta->execute(['studio_json', json_encode($newState['studio'])]);
        $stmtAudit->execute(['studio', 'studio', $op, $actor, json_encode($oldState['studio']), json_encode($newState['studio']), $now]);
    }

    // Service rates change
    if ($oldState['serviceRates'] != $newState['serviceRates']) {
        $db->exec('DELETE FROM service_rates');
        $stmtSR = $db->prepare('INSERT INTO service_rates (key, kind, description, amount_cents, position) VALUES (?, ?, ?, ?, ?)');
        foreach ($newState['serviceRates'] as $pos => $sr) {
            $stmtSR->execute([
                $sr['key'],
                $sr['kind'] ?? 'custom',
                $sr['description'],
                (int)round(((float)$sr['amount']) * 100),
                $pos
            ]);
        }
        $stmtAudit->execute(['service_rates', 'rates', $op, $actor, json_encode($oldState['serviceRates']), json_encode($newState['serviceRates']), $now]);
    }

    // Counters change
    foreach ($newState['counters'] as $name => $last) {
        if (($oldState['counters'][$name] ?? null) !== $last) {
            $stmtC = $db->prepare('INSERT OR REPLACE INTO counters (name, last_number) VALUES (?, ?)');
            $stmtC->execute([(string)$name, (int)$last]);
        }
    }

    // Clients change
    $stmtInsCl = $db->prepare('INSERT INTO clients (id, name, vat, cf, address, zip, city, province, sdi, pec, email, delivery_channel, dossier_id, months, next_date, anchor, days, active, vat_rate, fund_rate, withholding_rate, stamp, nature, lines_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmtUpdCl = $db->prepare('UPDATE clients SET name=?, vat=?, cf=?, address=?, zip=?, city=?, province=?, sdi=?, pec=?, email=?, delivery_channel=?, dossier_id=?, months=?, next_date=?, anchor=?, days=?, active=?, vat_rate=?, fund_rate=?, withholding_rate=?, stamp=?, nature=?, lines_json=? WHERE id=?');
    foreach ($newState['clients'] as $cid => $c) {
        $oldC = $oldState['clients'][$cid] ?? null;
        if ($oldC != $c) {
            $params = [
                $c['name'] ?? '',
                $c['vat'] ?? '',
                $c['cf'] ?? '',
                $c['address'] ?? '',
                $c['zip'] ?? '',
                $c['city'] ?? '',
                $c['province'] ?? '',
                $c['sdi'] ?? '',
                $c['pec'] ?? '',
                $c['email'] ?? '',
                $c['deliveryChannel'] ?? '',
                $c['dossierId'] ?? '',
                (int)($c['months'] ?? 3),
                $c['nextDate'] ?? date('Y-m-d'),
                (int)($c['anchor'] ?? 1),
                (int)($c['days'] ?? 0),
                !empty($c['active']) ? 1 : 0,
                (float)($c['vatRate'] ?? 22),
                (float)($c['fundRate'] ?? 4),
                (float)($c['withholdingRate'] ?? 20),
                (float)($c['stamp'] ?? 0),
                $c['nature'] ?? 'N2.2',
                json_encode($c['lines'] ?? [])
            ];
            if ($oldC !== null) {
                $params[] = $c['id'];
                $stmtUpdCl->execute($params);
            } else {
                array_unshift($params, $c['id']);
                $stmtInsCl->execute($params);
            }
            $stmtAudit->execute(['client', $cid, $op, $actor, $oldC ? json_encode($oldC) : null, json_encode($c), $now]);
        }
    }

    // Notices change
    $stmtInsN = $db->prepare('INSERT INTO notices (id, number, client_id, date, due, period_json, service_description, note, recurrence_key, cancelled, vat_rate, fund_rate, withholding_rate, stamp, nature, totals_base, totals_fund, totals_vat, totals_withholding, totals_stamp, totals_gross, totals_net, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmtUpdN = $db->prepare('UPDATE notices SET number=?, client_id=?, date=?, due=?, period_json=?, service_description=?, note=?, recurrence_key=?, cancelled=?, vat_rate=?, fund_rate=?, withholding_rate=?, stamp=?, nature=?, totals_base=?, totals_fund=?, totals_vat=?, totals_withholding=?, totals_stamp=?, totals_gross=?, totals_net=? WHERE id=?');
    $stmtDelNL = $db->prepare('DELETE FROM notice_lines WHERE notice_id = ?');
    $stmtNL = $db->prepare('INSERT INTO notice_lines (id, notice_id, position, description, amount_cents, quantity_cents, basis) VALUES (?, ?, ?, ?, ?, ?, ?)');

    $stmtInsP = $db->prepare('INSERT INTO payments (id, notice_id, date, amount_cents, reference, invoice_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $stmtUpdP = $db->prepare('UPDATE payments SET date = ?, amount_cents = ?, reference = ?, invoice_id = ? WHERE id = ?');
    $stmtCheckP = $db->prepare('SELECT 1 FROM payments WHERE id = ?');

    foreach ($newState['notices'] as $nid => $n) {
        $oldN = $oldState['notices'][$nid] ?? null;
        if ($oldN != $n) {
            $tot = $n['totals'] ?? [];
            $rt = $n['rates'] ?? [];
            if ($oldN !== null) {
                $stmtUpdN->execute([
                    $n['number'],
                    $n['clientId'],
                    $n['date'],
                    $n['due'],
                    !empty($n['period']) ? json_encode($n['period']) : null,
                    $n['serviceDescription'] ?? '',
                    $n['note'] ?? '',
                    $n['recurrenceKey'] ?? '',
                    !empty($n['cancelled']) ? 1 : 0,
                    (float)($rt['vatRate'] ?? 22),
                    (float)($rt['fundRate'] ?? 4),
                    (float)($rt['withholdingRate'] ?? 20),
                    (float)($rt['stamp'] ?? 0),
                    $rt['nature'] ?? 'N2.2',
                    (int)($tot['base'] ?? 0),
                    (int)($tot['fund'] ?? 0),
                    (int)($tot['vat'] ?? 0),
                    (int)($tot['withholding'] ?? 0),
                    (int)($tot['stamp'] ?? 0),
                    (int)($tot['gross'] ?? 0),
                    (int)($tot['net'] ?? 0),
                    $n['id']
                ]);
            } else {
                $stmtInsN->execute([
                    $n['id'],
                    $n['number'],
                    $n['clientId'],
                    $n['date'],
                    $n['due'],
                    !empty($n['period']) ? json_encode($n['period']) : null,
                    $n['serviceDescription'] ?? '',
                    $n['note'] ?? '',
                    $n['recurrenceKey'] ?? '',
                    !empty($n['cancelled']) ? 1 : 0,
                    (float)($rt['vatRate'] ?? 22),
                    (float)($rt['fundRate'] ?? 4),
                    (float)($rt['withholdingRate'] ?? 20),
                    (float)($rt['stamp'] ?? 0),
                    $rt['nature'] ?? 'N2.2',
                    (int)($tot['base'] ?? 0),
                    (int)($tot['fund'] ?? 0),
                    (int)($tot['vat'] ?? 0),
                    (int)($tot['withholding'] ?? 0),
                    (int)($tot['stamp'] ?? 0),
                    (int)($tot['gross'] ?? 0),
                    (int)($tot['net'] ?? 0),
                    $n['date'] . 'T00:00:00Z'
                ]);
            }

            // Sync lines if changed
            if ($oldN === null || ($oldN['lines'] ?? null) != ($n['lines'] ?? null)) {
                $stmtDelNL->execute([$nid]);
                foreach (($n['lines'] ?? []) as $idx => $line) {
                    $stmtNL->execute([
                        $nid . '_l_' . $idx,
                        $nid,
                        $idx,
                        $line['description'] ?? '',
                        (int)round(((float)($line['amount'] ?? 0)) * 100),
                        (int)round(((float)($line['quantity'] ?? 1)) * 100),
                        $line['basis'] ?? 'item'
                    ]);
                }
            }

            // Sync payments if changed
            if ($oldN === null || ($oldN['payments'] ?? null) != ($n['payments'] ?? null)) {
                foreach (($n['payments'] ?? []) as $pm) {
                    $stmtCheckP->execute([$pm['id']]);
                    if ($stmtCheckP->fetchColumn()) {
                        $stmtUpdP->execute([
                            $pm['date'],
                            (int)($pm['amount'] ?? 0),
                            $pm['reference'] ?? '',
                            $pm['invoiceId'] ?: null,
                            $pm['id']
                        ]);
                    } else {
                        $stmtInsP->execute([
                            $pm['id'],
                            $nid,
                            $pm['date'],
                            (int)($pm['amount'] ?? 0),
                            $pm['reference'] ?? '',
                            $pm['invoiceId'] ?: null,
                            $pm['date'] . 'T00:00:00Z'
                        ]);
                    }
                }
            }

            $stmtAudit->execute(['notice', $nid, $op, $actor, $oldN ? json_encode($oldN) : null, json_encode($n), $now]);
        }
    }

    // Invoices change
    $stmtInsInv = $db->prepare('INSERT INTO invoices (id, number, notice_id, payment_id, date, payment_date, status, transmission_reference, filename, xml_hash_sha256, xml_content, totals_base, totals_fund, totals_vat, totals_withholding, totals_stamp, totals_gross, totals_net, lines_json, rates_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmtUpdInv = $db->prepare('UPDATE invoices SET number=?, notice_id=?, payment_id=?, date=?, payment_date=?, status=?, transmission_reference=?, filename=?, xml_hash_sha256=?, xml_content=?, totals_base=?, totals_fund=?, totals_vat=?, totals_withholding=?, totals_stamp=?, totals_gross=?, totals_net=?, lines_json=?, rates_json=? WHERE id=?');

    foreach ($newState['invoices'] as $fid => $inv) {
        $oldInv = $oldState['invoices'][$fid] ?? null;
        if ($oldInv != $inv) {
            $tot = $inv['totals'] ?? [];
            $xml = $inv['xml'] ?? ($oldInv['xml'] ?? '');
            $hash = $inv['sha256'] ?? ($xml ? hash('sha256', $xml) : '');
            if ($oldInv !== null) {
                $stmtUpdInv->execute([
                    $inv['number'],
                    $inv['noticeId'] ?? '',
                    $inv['paymentId'] ?? null,
                    $inv['date'],
                    $inv['paymentDate'] ?? $inv['date'],
                    $inv['status'] ?? 'da_inviare',
                    $inv['transmissionReference'] ?? '',
                    $inv['filename'] ?? '',
                    $hash,
                    $xml,
                    (int)($tot['base'] ?? 0),
                    (int)($tot['fund'] ?? 0),
                    (int)($tot['vat'] ?? 0),
                    (int)($tot['withholding'] ?? 0),
                    (int)($tot['stamp'] ?? 0),
                    (int)($tot['gross'] ?? 0),
                    (int)($tot['net'] ?? 0),
                    json_encode($inv['lines'] ?? []),
                    json_encode($inv['rates'] ?? []),
                    $inv['id']
                ]);
            } else {
                $stmtInsInv->execute([
                    $inv['id'],
                    $inv['number'],
                    $inv['noticeId'] ?? '',
                    $inv['paymentId'] ?? null,
                    $inv['date'],
                    $inv['paymentDate'] ?? $inv['date'],
                    $inv['status'] ?? 'da_inviare',
                    $inv['transmissionReference'] ?? '',
                    $inv['filename'] ?? '',
                    $hash,
                    $xml,
                    (int)($tot['base'] ?? 0),
                    (int)($tot['fund'] ?? 0),
                    (int)($tot['vat'] ?? 0),
                    (int)($tot['withholding'] ?? 0),
                    (int)($tot['stamp'] ?? 0),
                    (int)($tot['gross'] ?? 0),
                    (int)($tot['net'] ?? 0),
                    json_encode($inv['lines'] ?? []),
                    json_encode($inv['rates'] ?? []),
                    $inv['date'] . 'T00:00:00Z'
                ]);
            }
            $stmtAudit->execute(['invoice', $fid, $op, $actor, $oldInv ? json_encode($oldInv) : null, json_encode($inv), $now]);
        }
    }
}

function recordNoticeEmailSent(PDO $db, string $noticeId, string $toEmail, string $actor): array {
    $info = [
        'at' => date(DATE_ATOM),
        'to' => $toEmail,
        'actor' => $actor
    ];
    $stmt = $db->prepare('UPDATE notices SET sent_email_json = ? WHERE id = ?');
    $stmt->execute([json_encode($info), $noticeId]);
    
    $stmtAudit = $db->prepare('INSERT INTO audit_log (entity, entity_id, operation, actor, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $stmtAudit->execute(['notice', $noticeId, 'send_email', $actor, null, json_encode($info), date(DATE_ATOM)]);
    return $info;
}

function updateClientEmail(PDO $db, string $clientId, string $email, string $actor): void {
    if ($email !== '') {
        demand(filter_var($email, FILTER_VALIDATE_EMAIL) !== false, 'Indirizzo email non valido: ' . $email);
    }
    $stmtPrev = $db->prepare('SELECT email FROM clients WHERE id = ?');
    $stmtPrev->execute([$clientId]);
    $prev = $stmtPrev->fetchColumn();
    
    $stmt = $db->prepare('UPDATE clients SET email = ? WHERE id = ?');
    $stmt->execute([$email, $clientId]);
    
    $stmtAudit = $db->prepare('INSERT INTO audit_log (entity, entity_id, operation, actor, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $stmtAudit->execute(['client', $clientId, 'update_email', $actor, json_encode(['email' => $prev]), json_encode(['email' => $email]), date(DATE_ATOM)]);
}

