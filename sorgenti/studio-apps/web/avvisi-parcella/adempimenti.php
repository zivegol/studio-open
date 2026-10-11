<?php
declare(strict_types=1);

function normalizeClientName(string $s): string {
    $s = mb_strtolower(trim($s), 'UTF-8');
    // Remove common company designations
    $s = preg_replace('/\b(srl|snc|spa|srls|d\.i\.|sas|soc\.?\s*agr\.?|societ[aà]\s+agricola)\b/u', '', $s);
    // Remove non-alphanumeric characters
    $s = preg_replace('/[^a-z0-9]/u', '', $s);
    return trim($s);
}

function getRateForKind(string $kind, array $rates, float $default, string $defaultDesc): array {
    foreach ($rates as $r) {
        if (($r['kind'] ?? '') === $kind || ($r['key'] ?? '') === $kind) {
            return [
                'amount' => (float)$r['amount'],
                'description' => !empty($r['description']) ? (string)$r['description'] : $defaultDesc
            ];
        }
    }
    return ['amount' => $default, 'description' => $defaultDesc];
}

function parseAdempimentiCell(string $text, array $rates = []): array {
    $text = trim($text);
    if ($text === '') return [];

    $rateF24 = getRateForKind('f24', $rates, 10.0, 'F24 elaborati e trasmessi telematicamente');
    $rateVisto = getRateForKind('visto', $rates, 300.0, 'Visto di conformità');
    $rateVisura = getRateForKind('visura', $rates, 10.0, 'Richiesta visure camerali');
    $rateCciaa = getRateForKind('cciaa', $rates, 100.0, 'Pratiche CCIAA');
    $rateAde = getRateForKind('ade', $rates, 100.0, 'Pratiche Agenzia delle Entrate');

    // Pure number
    if (is_numeric($text)) {
        $num = (float)$text;
        return [
            [
                'kind' => 'f24',
                'description' => $rateF24['description'],
                'quantity' => $num,
                'unitPrice' => $rateF24['amount'],
                'sourceText' => $text
            ]
        ];
    }

    $items = [];
    $parts = preg_split('/(?:\+|\n|;)/', $text);
    foreach ($parts as $part) {
        $p = trim($part);
        if ($p === '') continue;

        // F24 (e.g. "1 f24", "2 F24 SOCI", "3 F24", "4F24")
        if (preg_match('/(\d+)\s*f24(?:\s+soci|\s+socio)?/i', $p, $m)) {
            $qty = (float)$m[1];
            $items[] = [
                'kind' => 'f24',
                'description' => $rateF24['description'],
                'quantity' => $qty,
                'unitPrice' => $rateF24['amount'],
                'sourceText' => $p
            ];
            continue;
        }

        // Visto di conformità
        if (preg_match('/visto/i', $p)) {
            $qty = 1.0;
            if (preg_match('/(\d+)\s*vist/i', $p, $m)) $qty = (float)$m[1];
            $items[] = [
                'kind' => 'visto',
                'description' => $rateVisto['description'],
                'quantity' => $qty,
                'unitPrice' => $rateVisto['amount'],
                'sourceText' => $p
            ];
            continue;
        }

        // Visure
        if (preg_match('/visur/i', $p)) {
            $qty = 1.0;
            if (preg_match('/(\d+)\s*visur/i', $p, $m)) $qty = (float)$m[1];
            $items[] = [
                'kind' => 'visura',
                'description' => $rateVisura['description'],
                'quantity' => $qty,
                'unitPrice' => $rateVisura['amount'],
                'sourceText' => $p
            ];
            continue;
        }

        // Pratiche CCIAA
        if (preg_match('/cciaa/i', $p)) {
            $qty = 1.0;
            if (preg_match('/(\d+)\s*pratic/i', $p, $m)) $qty = (float)$m[1];
            $items[] = [
                'kind' => 'cciaa',
                'description' => $rateCciaa['description'],
                'quantity' => $qty,
                'unitPrice' => $rateCciaa['amount'],
                'sourceText' => $p
            ];
            continue;
        }

        // Pratiche Agenzia Entrate
        if (preg_match('/agenzia\s+entrate|ag\.?\s*entrate/i', $p)) {
            $qty = 1.0;
            if (preg_match('/(\d+)\s*pratic/i', $p, $m)) $qty = (float)$m[1];
            $items[] = [
                'kind' => 'ade',
                'description' => $rateAde['description'],
                'quantity' => $qty,
                'unitPrice' => $rateAde['amount'],
                'sourceText' => $p
            ];
            continue;
        }

        // Check any custom rates in $rates matching description
        $matchedCustom = null;
        foreach ($rates as $cr) {
            $cDesc = trim((string)($cr['description'] ?? ''));
            if ($cDesc !== '' && stripos($p, $cDesc) !== false) {
                $matchedCustom = $cr;
                break;
            }
        }
        if ($matchedCustom) {
            $qty = 1.0;
            if (preg_match('/(\d+)/', $p, $m)) $qty = (float)$m[1];
            $items[] = [
                'kind' => 'custom',
                'description' => $matchedCustom['description'],
                'quantity' => $qty,
                'unitPrice' => (float)$matchedCustom['amount'],
                'sourceText' => $p
            ];
            continue;
        }

        // Standalone number + label e.g. "2 DURC"
        if (preg_match('/^(\d+)\s+(.+)$/i', $p, $m)) {
            $qty = (float)$m[1];
            $items[] = [
                'kind' => 'other',
                'description' => trim($m[2]),
                'quantity' => $qty,
                'unitPrice' => 0.0,
                'sourceText' => $p
            ];
            continue;
        }

        $items[] = [
            'kind' => 'other',
            'description' => $p,
            'quantity' => 1.0,
            'unitPrice' => 0.0,
            'sourceText' => $p
        ];
    }
    return $items;
}

function getAdempimentiFilePath(): string {
    $dataDir = '/var/www/html/data';
    if (class_exists('\\OC') && isset(\OC::$server)) {
        try {
            $dataDir = (string)\OC::$server->getConfig()->getSystemValue('datadirectory', \OC::$SERVERROOT . '/data');
        } catch (Throwable) {}
    }
    $primary = $dataDir . '/admin/files/studio-example/archivio studio-example/adempimenti CLIENTI.xlsx';
    if (is_file($primary)) return $primary;

    // Fallbacks if data directory mounted differently
    $fallbacks = [
        '/var/www/html/data/admin/files/studio-example/archivio studio-example/adempimenti CLIENTI.xlsx',
        'C:/nextcloud/data/admin/files/studio-example/archivio studio-example/adempimenti CLIENTI.xlsx'
    ];
    foreach ($fallbacks as $fb) {
        if (is_file($fb)) return $fb;
    }
    return $primary;
}

function getAdempimentiDb(?PDO $db = null): ?PDO {
    if ($db !== null) return $db;
    $dbPath = '/var/www/html/data/studio-parcelle/parcelle.sqlite';
    if (class_exists('\\OC') && isset(\OC::$server)) {
        try {
            $dataDir = (string)\OC::$server->getConfig()->getSystemValue('datadirectory', \OC::$SERVERROOT . '/data');
            $dbPath = $dataDir . '/studio-parcelle/parcelle.sqlite';
        } catch (Throwable) {}
    }
    if (is_file($dbPath)) {
        try {
            require_once __DIR__ . '/db.php';
            $pdo = getDb($dbPath);
            initRelationalSchema($pdo);
            return $pdo;
        } catch (Throwable) {}
    }
    return null;
}

function parseAdempimentiDataFromXlsx(int $year = 2026, ?string $xlsxPath = null): array {
    $xlsxPath ??= getAdempimentiFilePath();
    if (!is_file($xlsxPath)) {
        return ['error' => 'File adempimenti non trovato: ' . $xlsxPath, 'clients' => []];
    }

    $zip = new ZipArchive();
    if ($zip->open($xlsxPath) !== true) {
        return ['error' => 'Impossibile aprire il file Excel adempimenti', 'clients' => []];
    }

    // Shared strings
    $strings = [];
    $stringsRaw = $zip->getFromName('xl/sharedStrings.xml');
    if ($stringsRaw) {
        $stringsXml = simplexml_load_string($stringsRaw);
        if ($stringsXml && isset($stringsXml->si)) {
            foreach ($stringsXml->si as $val) {
                $t = (string)$val->t;
                if (!$t && $val->r) {
                    foreach ($val->r as $r) $t .= (string)$r->t;
                }
                $strings[] = $t;
            }
        }
    }

    // Workbook relationships to find sheet for $year
    $sheetTarget = null; // Never silently read a different year
    $wbRaw = $zip->getFromName('xl/workbook.xml');
    $relsRaw = $zip->getFromName('xl/_rels/workbook.xml.rels');
    if ($wbRaw && $relsRaw) {
        $wbXml = simplexml_load_string($wbRaw);
        $relsXml = simplexml_load_string($relsRaw);
        $relMap = [];
        if ($relsXml && isset($relsXml->Relationship)) {
            foreach ($relsXml->Relationship as $rel) {
                $relMap[(string)$rel['Id']] = (string)$rel['Target'];
            }
        }
        if ($wbXml && isset($wbXml->sheets->sheet)) {
            foreach ($wbXml->sheets->sheet as $s) {
                $name = (string)$s['name'];
                if (strpos($name, (string)$year) !== false) {
                    $rId = (string)$s->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
                    if (isset($relMap[$rId])) {
                        $target = $relMap[$rId];
                        $sheetTarget = str_starts_with($target, '/') ? ltrim($target, '/') : 'xl/' . $target;
                    }
                    break;
                }
            }
        }
    }

    if ($sheetTarget === null) { $zip->close(); return ['error' => "Foglio anno $year non trovato nel file Excel", 'clients' => []]; }
    $sheetRaw = $zip->getFromName($sheetTarget);
    $zip->close();

    if (!$sheetRaw) {
        return ['error' => "Foglio anno $year non trovato nel file Excel", 'clients' => []];
    }

    $sheetXml = simplexml_load_string($sheetRaw);
    if (!$sheetXml || !isset($sheetXml->sheetData->row)) {
        return ['error' => "Foglio anno $year non leggibile", 'clients' => []];
    }

    $monthNames = ['GENNAIO','FEBBRAIO','MARZO','APRILE','MAGGIO','GIUGNO','LUGLIO','AGOSTO','SETTEMBRE','OTTOBRE','NOVEMBRE','DICEMBRE'];
    $cellValue = function($c) use ($strings): string {
        if ((string)$c['t'] === 's') return trim($strings[(int)$c->v] ?? '');
        if ((string)$c['t'] === 'inlineStr') {
            $v=(string)$c->is->t;
            foreach($c->is->r as $r)$v.=(string)$r->t;
            return trim($v);
        }
        return trim((string)$c->v);
    };
    $monthCols=[]; $nameCol=null; $vatCol=null; $cfCol=null; $headerRow=null;
    foreach($sheetXml->sheetData->row as $row){
        foreach($row->c as $c){
            $col=preg_replace('/[0-9]/','',(string)$c['r']);
            $v=mb_strtoupper($cellValue($c));
            foreach($monthNames as $i=>$monthName)if(preg_match('/^F24\s+'.$monthName.'$/u',$v))$monthCols[$col]=$i+1;
            if(str_contains($v,'D.I.') && str_contains($v,'SRL')){
                $n=0;foreach(str_split($col) as $ch)$n=$n*26+ord($ch)-64;
                $n--; $nameCol='';while($n>0){$n--;$nameCol=chr(65+$n%26).$nameCol;$n=intdiv($n,26);}
            }
            if(in_array($v,['P.IVA','P. IVA','PARTITA IVA'],true))$vatCol=$col;
            if(in_array($v,['C.F.','CF','CODICE FISCALE'],true))$cfCol=$col;
        }
        if(count($monthCols)===12){$headerRow=(int)$row['r'];break;}
    }
    if(count($monthCols)!==12 || !$nameCol)return ['error'=>"Intestazioni clienti/mesi non riconosciute per $year",'clients'=>[]];
    $clients = [];

    foreach ($sheetXml->sheetData->row as $row) {
        $rIdx = (int)$row['r'];
        if ($rIdx <= $headerRow) continue;

        $vat = '';
        $cf = '';
        $name = '';
        $months = [];

        foreach ($row->c as $c) {
            $ref = (string)$c['r'];
            $col = preg_replace('/[0-9]/', '', $ref);
            $val = $cellValue($c);
            if ($col === $vatCol) $vat = $val;
            elseif ($col === $cfCol) $cf = $val;
            elseif ($col === $nameCol) $name = $val;
            elseif (isset($monthCols[$col])) {
                $monthNum = $monthCols[$col];
                if ($val !== '') {
                    $months[$monthNum] = $val;
                }
            }
        }

        if ($name !== '') {
            $clients[] = [
                'row' => $rIdx,
                'name' => $name,
                'normalizedName' => normalizeClientName($name),
                'vat' => preg_replace('/[^0-9]/', '', $vat),
                'cf' => strtoupper(preg_replace('/[^A-Z0-9]/i', '', $cf)),
                'months' => $months
            ];
        }
    }

    return [
        'year' => $year,
        'cachedAt' => date(DATE_ATOM),
        'totalClients' => count($clients),
        'clients' => $clients
    ];
}

function seedAdempimentiFromExcelIfEmpty(PDO $db): void {
    try {
        $count = (int)$db->query('SELECT count(*) FROM adempimenti_clients')->fetchColumn();
        if ($count > 0) return; // already seeded
    } catch (Throwable) {
        return;
    }

    $years = [2025, 2026];
    $now = date(DATE_ATOM);
    $db->beginTransaction();
    try {
        $stmtClient = $db->prepare('INSERT OR IGNORE INTO adempimenti_clients (id, name, normalized_name, vat, cf, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        $stmtCell = $db->prepare('INSERT OR REPLACE INTO adempimenti_cells (id, client_name, year, month, raw_text, parsed_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

        foreach ($years as $y) {
            $parsed = parseAdempimentiDataFromXlsx($y);
            foreach (($parsed['clients'] ?? []) as $c) {
                $cid = 'adc_' . md5($c['name']);
                $stmtClient->execute([
                    $cid,
                    $c['name'],
                    $c['normalizedName'],
                    $c['vat'] ?? '',
                    $c['cf'] ?? '',
                    $now
                ]);

                foreach (($c['months'] ?? []) as $mNum => $raw) {
                    if ($y > 2026 || ($y === 2026 && (int)$mNum >= 10)) continue;
                    if (trim((string)$raw) === '') continue;
                    $cellId = 'adcell_' . md5($c['name'] . ':' . $y . ':' . $mNum);
                    $parsedItems = parseAdempimentiCell((string)$raw);
                    $stmtCell->execute([
                        $cellId,
                        $c['name'],
                        $y,
                        (int)$mNum,
                        (string)$raw,
                        json_encode($parsedItems, JSON_UNESCAPED_UNICODE),
                        $now,
                        'import_excel'
                    ]);
                }
            }
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
    }
}

function loadAdempimentiData(int $year = 2026, ?PDO $db = null): array {
    $pdo = getAdempimentiDb($db);
    if ($pdo !== null) {
        seedAdempimentiFromExcelIfEmpty($pdo);
        try {
            $clRows = $pdo->query('SELECT name, normalized_name, vat, cf FROM adempimenti_clients ORDER BY name ASC')->fetchAll(PDO::FETCH_ASSOC);
            if (!empty($clRows)) {
                $stmtCells = $pdo->prepare('SELECT client_name, month, raw_text FROM adempimenti_cells WHERE year = ?');
                $stmtCells->execute([$year]);
                $cellRows = $stmtCells->fetchAll(PDO::FETCH_ASSOC);
                
                $cellsByClient = [];
                foreach ($cellRows as $cr) {
                    if ($cr['raw_text'] !== '') {
                        $cellsByClient[$cr['client_name']][(int)$cr['month']] = $cr['raw_text'];
                    }
                }

                $emailMap = [];
                try {
                    $studioClients = $pdo->query('SELECT name, vat, cf, email FROM clients WHERE email IS NOT NULL AND email != ""')->fetchAll(PDO::FETCH_ASSOC);
                    foreach ($studioClients as $sc) {
                        if (!empty($sc['email'])) {
                            if (!empty($sc['vat'])) $emailMap['vat:' . preg_replace('/[^0-9]/', '', $sc['vat'])] = $sc['email'];
                            if (!empty($sc['cf'])) $emailMap['cf:' . strtoupper(trim($sc['cf']))] = $sc['email'];
                            $emailMap['norm:' . normalizeClientName($sc['name'])] = $sc['email'];
                        }
                    }
                } catch (Throwable) {}

                $clients = [];
                foreach ($clRows as $r) {
                    $cEmail = $emailMap['vat:' . ($r['vat'] ?? '')] 
                           ?? $emailMap['cf:' . ($r['cf'] ?? '')] 
                           ?? $emailMap['norm:' . ($r['normalized_name'] ?? '')] 
                           ?? '';
                    $clients[] = [
                        'name' => $r['name'],
                        'normalizedName' => $r['normalized_name'],
                        'vat' => $r['vat'] ?? '',
                        'cf' => $r['cf'] ?? '',
                        'email' => $cEmail,
                        'months' => $cellsByClient[$r['name']] ?? []
                    ];
                }

                return [
                    'year' => $year,
                    'source' => 'sqlite',
                    'cachedAt' => date(DATE_ATOM),
                    'totalClients' => count($clients),
                    'clients' => $clients
                ];
            }
        } catch (Throwable) {}
    }

    // Fallback directly to Excel parsing if DB is not available
    if($year>2026)return ['year'=>$year,'error'=>'Registro Adempimenti non disponibile. Dal quarto trimestre 2026 la fonte è esclusivamente il registro.','clients'=>[]];
    $historical=parseAdempimentiDataFromXlsx($year);
    if($year===2026)foreach($historical['clients'] as &$c){$c['months']=array_filter($c['months'],fn($m)=>(int)$m<10,ARRAY_FILTER_USE_KEY);}unset($c);
    return $historical;
}

function saveAdempimentoCell(PDO $db, string $clientName, int $year, int $month, string $text, string $actor, array $rates = []): array {
    demand($month >= 1 && $month <= 12, 'Mese non valido');
    demand($year >= 2020 && $year <= 2040, 'Anno non valido');
    $clientName = trim($clientName);
    demand($clientName !== '', 'Nome cliente obbligatorio');

    $text = trim($text);
    $now = date(DATE_ATOM);

    // Ensure client exists
    $stmtC = $db->prepare('SELECT name FROM adempimenti_clients WHERE name = ?');
    $stmtC->execute([$clientName]);
    if (!$stmtC->fetchColumn()) {
        $stmtInsC = $db->prepare('INSERT INTO adempimenti_clients (id, name, normalized_name, vat, cf, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        $stmtInsC->execute([
            'adc_' . md5($clientName),
            $clientName,
            normalizeClientName($clientName),
            '',
            '',
            $now
        ]);
    }

    $parsedItems = parseAdempimentiCell($text, $rates);
    $cellId = 'adcell_' . md5($clientName . ':' . $year . ':' . $month);

    $stmtPrev = $db->prepare('SELECT raw_text FROM adempimenti_cells WHERE client_name = ? AND year = ? AND month = ?');
    $stmtPrev->execute([$clientName, $year, $month]);
    $prevText = $stmtPrev->fetchColumn();

    if ($text === '') {
        $stmtDel = $db->prepare('DELETE FROM adempimenti_cells WHERE client_name = ? AND year = ? AND month = ?');
        $stmtDel->execute([$clientName, $year, $month]);
    } else {
        $stmtUpsert = $db->prepare('INSERT INTO adempimenti_cells (id, client_name, year, month, raw_text, parsed_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(client_name, year, month) DO UPDATE SET raw_text=excluded.raw_text, parsed_json=excluded.parsed_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by');
        $stmtUpsert->execute([
            $cellId,
            $clientName,
            $year,
            $month,
            $text,
            json_encode($parsedItems, JSON_UNESCAPED_UNICODE),
            $now,
            $actor
        ]);
    }

    // Audit log
    $stmtAudit = $db->prepare('INSERT INTO audit_log (entity, entity_id, operation, actor, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $stmtAudit->execute([
        'adempimenti_cell',
        $clientName . ':' . $year . ':' . $month,
        'update_cell',
        $actor,
        json_encode(['text' => $prevText ?: '']),
        json_encode(['text' => $text, 'parsed' => $parsedItems]),
        $now
    ]);

    return [
        'ok' => true,
        'clientName' => $clientName,
        'year' => $year,
        'month' => $month,
        'text' => $text,
        'parsed' => $parsedItems
    ];
}

function addAdempimentiClient(PDO $db, string $name, string $vat, string $cf, string $actor): array {
    $name = trim($name);
    demand($name !== '', 'Denominazione cliente obbligatoria');
    $vat = preg_replace('/[^0-9]/', '', $vat);
    $cf = strtoupper(trim($cf));
    $now = date(DATE_ATOM);

    $id = 'adc_' . md5($name);
    $stmt = $db->prepare('INSERT INTO adempimenti_clients (id, name, normalized_name, vat, cf, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET vat=excluded.vat, cf=excluded.cf');
    $stmt->execute([
        $id,
        $name,
        normalizeClientName($name),
        $vat,
        $cf,
        $now
    ]);

    $stmtAudit = $db->prepare('INSERT INTO audit_log (entity, entity_id, operation, actor, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $stmtAudit->execute(['adempimenti_client', $name, 'add_client', $actor, null, json_encode(compact('name','vat','cf')), $now]);

    return ['ok' => true, 'name' => $name, 'vat' => $vat, 'cf' => $cf];
}

function exportAdempimentiCsv(PDO $db, int $year): string {
    $data = loadAdempimentiData($year, $db);
    $monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    
    // Output with UTF-8 BOM for Microsoft Excel compatibility
    $csv = "\xEF\xBB\xBF";
    $csv .= "Cliente;Partita IVA;Codice Fiscale;" . implode(';', $monthNames) . "\r\n";

    foreach (($data['clients'] ?? []) as $c) {
        $row = [
            '"' . str_replace('"', '""', $c['name']) . '"',
            '"' . ($c['vat'] ?? '') . '"',
            '"' . ($c['cf'] ?? '') . '"'
        ];
        for ($m = 1; $m <= 12; $m++) {
            $val = $c['months'][$m] ?? '';
            $row[] = '"' . str_replace('"', '""', $val) . '"';
        }
        $csv .= implode(';', $row) . "\r\n";
    }

    return $csv;
}

function getClientAdempimentiForQuarters(array $client, array $quarters, int $year = 2026, array $rates = [], ?PDO $db = null): array {
    $data = loadAdempimentiData($year, $db);
    if (!empty($data['error'])) {
        return [
            'matched' => false,
            'message' => $data['error'],
            'proposedLines' => [],
            'details' => []
        ];
    }

    $quarters = array_values(array_unique(array_filter(array_map('intval', $quarters), fn($q) => $q >= 1 && $q <= 4)));
    if (empty($quarters)) $quarters = [1];
    sort($quarters);

    $targetVat = preg_replace('/[^0-9]/', '', (string)($client['vat'] ?? ''));
    $targetCf = strtoupper(preg_replace('/[^A-Z0-9]/i', '', (string)($client['cf'] ?? '')));
    $targetNormName = normalizeClientName((string)($client['name'] ?? ''));

    $matchedRecord = null;
    foreach ($data['clients'] as $c) {
        // Match by VAT
        if ($targetVat !== '' && !empty($c['vat']) && $c['vat'] === $targetVat) {
            $matchedRecord = $c;
            break;
        }
        // Match by CF
        if ($targetCf !== '' && !empty($c['cf']) && $c['cf'] === $targetCf) {
            $matchedRecord = $c;
            break;
        }
        // Match by Normalized Name
        if ($targetNormName !== '' && $c['normalizedName'] === $targetNormName) {
            $matchedRecord = $c;
            break;
        }
    }

    // Secondary fallback: substring match in name if not found
    if (!$matchedRecord && $targetNormName !== '') {
        foreach ($data['clients'] as $c) {
            if (strlen($targetNormName) >= 4 && (strpos($c['normalizedName'], $targetNormName) !== false || strpos($targetNormName, $c['normalizedName']) !== false)) {
                $matchedRecord = $c;
                break;
            }
        }
    }

    if (!$matchedRecord) {
        return [
            'matched' => false,
            'message' => 'Nessun adempimento trovato nel registro per questo cliente.',
            'proposedLines' => [],
            'details' => []
        ];
    }

    $monthNames = [
        1 => 'Gennaio', 2 => 'Febbraio', 3 => 'Marzo',
        4 => 'Aprile', 5 => 'Maggio', 6 => 'Giugno',
        7 => 'Luglio', 8 => 'Agosto', 9 => 'Settembre',
        10 => 'Ottobre', 11 => 'Novembre', 12 => 'Dicembre'
    ];

    $monthMap = [];
    foreach ($quarters as $q) {
        $start = ($q - 1) * 3 + 1;
        $monthMap[] = $start;
        $monthMap[] = $start + 1;
        $monthMap[] = $start + 2;
    }

    $aggregated = [];
    $rawDetails = [];
    $monthSummaries = [];

    foreach ($monthMap as $m) {
        $raw = $matchedRecord['months'][$m] ?? '';
        if ($raw === '') continue;
        $parsed = parseAdempimentiCell($raw, $rates);
        $rawDetails[$m] = [
            'month' => $m,
            'monthName' => $monthNames[$m],
            'raw' => $raw,
            'items' => $parsed
        ];
        $monthSummaries[] = $monthNames[$m] . ': ' . $raw;

        foreach ($parsed as $item) {
            $key = $item['kind'] . '::' . $item['description'];
            if (!isset($aggregated[$key])) {
                $aggregated[$key] = [
                    'kind' => $item['kind'],
                    'description' => $item['description'],
                    'quantity' => 0.0,
                    'amount' => $item['unitPrice'],
                    'basis' => 'item'
                ];
            }
            $aggregated[$key]['quantity'] += $item['quantity'];
        }
    }

    $qLabels = array_map(fn($q) => $q . '°', $quarters);
    $qText = implode(' e ', $qLabels) . ' trimestre ' . $year;

    $summaryText = '';
    if (!empty($aggregated)) {
        $parts = [];
        foreach ($aggregated as $item) {
            $parts[] = $item['quantity'] . ' ' . $item['description'] . ' (' . number_format($item['amount'], 2, ',', '.') . ' €/cad.)';
        }
        $summaryText = "Trovati per $qText: " . implode(' · ', $parts) . "\nRiferimenti mensili: " . implode(', ', $monthSummaries);
    } else {
        $summaryText = "Nessun adempimento extra registrato per $qText (mesi di riferimento: " . implode(', ', array_map(fn($m) => $monthNames[$m], $monthMap)) . ").";
    }

    return [
        'matched' => true,
        'clientName' => $matchedRecord['name'],
        'quarters' => $quarters,
        'year' => $year,
        'summaryText' => $summaryText,
        'proposedLines' => array_values($aggregated),
        'monthlyDetails' => array_values($rawDetails)
    ];
}
