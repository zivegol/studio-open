<?php
declare(strict_types=1);
require_once '/var/www/html/lib/base.php';
require_once '/var/www/studio-ade-official.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function reply(int $status, array $data): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit;
}
function taxcode(mixed $v): string {
    $v = strtoupper(trim((string)$v));
    if (!preg_match('/^(?:[0-9]{11}|[A-Z0-9]{16})$/D', $v)) reply(400, ['error'=>'Codice fiscale non valido.']);
    return $v;
}
function folder(\OCP\Files\Folder $root, string $path): \OCP\Files\Folder {
    foreach (explode('/', $path) as $part) {
        if ($part === '') continue;
        try { $node = $root->get($part); }
        catch (\OCP\Files\NotFoundException) { $node = $root->newFolder($part); }
        if (!$node instanceof \OCP\Files\Folder) throw new RuntimeException('Folder unavailable');
        $root = $node;
    }
    return $root;
}
function ade_cu_status(): array {
    $hasSecret = is_readable('/var/www/html/config/ade-cu.json');
    $hasCerts = is_readable('/var/www/html/config/ade-cu-certificates.json');
    $meta = null;
    $configuredAt = null;
    if ($hasCerts) {
        try {
            $raw = json_decode(@file_get_contents('/var/www/html/config/ade-cu-certificates.json') ?: '', true);
            if (is_array($raw)) {
                $dec = ade_cu_decrypt_certificates($raw);
                if ($dec !== false) {
                    $d = json_decode($dec, true);
                    $meta = $d['metadata'] ?? null;
                    $configuredAt = $d['configuredAt'] ?? null;
                }
            }
        } catch (\Throwable) {}
    }
    return [
        'configured' => $hasCerts && $hasSecret,
        'hasCerts' => $hasCerts,
        'hasSecret' => $hasSecret,
        'metadata' => $meta,
        'configuredAt' => $configuredAt
    ];
}

function ade_audit_log(string $userId, ?string $clientCf, string $operation, mixed $details, string $status = 'ok'): void {
    try {
        $db = \OC::$server->getDatabaseConnection();
        $ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $detailsStr = is_string($details) ? $details : json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $now = gmdate('Y-m-d H:i:s');
        $prevHash = $db->executeQuery("SELECT row_hash FROM oc_studio_ade_audit ORDER BY id DESC LIMIT 1")->fetchOne() ?: 'GENESIS';
        $rowHash = hash('sha256', $prevHash . '|' . $now . '|' . $userId . '|' . ($clientCf ?: '') . '|' . $operation . '|' . $detailsStr . '|' . $status . '|' . $ip);
        $db->executeStatement(
            "INSERT INTO oc_studio_ade_audit (timestamp, user_id, client_cf, operation, details, status, ip_address, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [$now, $userId, $clientCf, $operation, $detailsStr, $status, $ip, $prevHash, $rowHash]
        );
    } catch (\Throwable $e) {
        \OC::$server->getLogger()->error('Audit log write failure: ' . $e->getMessage(), ['app' => 'studio-ade']);
    }
}

$user = \OC::$server->getUserSession()->getUser();
if (!$user) reply(401, ['error'=>'Accedi a Nextcloud per usare il connettore.']);
$uid = $user->getUID();
if (!\OC::$server->getGroupManager()->isAdmin($uid) && !in_array(strtolower($uid), ['studio-example','info@studio.example'], true)) reply(403, ['error'=>'Utente non autorizzato.']);
$root = \OC::$server->getUserFolder($uid);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$op = (string)($_GET['op'] ?? 'bootstrap');
$base = 'Studio/AgenziaEntrate';

try {
    require __DIR__ . '/studio-ade-workspace.php';
    if ($method === 'GET' && $op === 'bootstrap') {
        $cu = ade_cu_status();
        $quotaState = json_decode(@file_get_contents('/var/www/html/config/ade-cu-quota.json') ?: '{}', true);
        $cuWait = max(0, ($quotaState['req_until'] ?? 0) - time());
        reply(200, [
            'requesttoken' => \OC::$server->getCsrfTokenManager()->getToken()->getEncryptedValue(),
            'user' => $user->getDisplayName(),
            'configured' => is_readable('/var/www/html/config/ade-anagrafiche.json'),
            'connectorConfigured' => is_readable('/var/www/html/config/ade-connector.key'),
            'mode' => 'official-api',
            'cuConfigured' => $cu['configured'],
            'cuMetadata' => $cu['metadata'],
            'cuHasSecret' => $cu['hasSecret'],
            'cuConfiguredAt' => $cu['configuredAt'],
            'cuRateLimitWait' => $cuWait
        ]);
    }

    // CU diagnostics / preliminary test
    if ($method === 'GET' && $op === 'cu-diagnostics') {
        $diag = ade_cu_diagnostics();
        reply(200, $diag);
    }

    // CU requests history registry (from MariaDB table oc_studio_ade_cu_queue)
    if ($method === 'GET' && $op === 'cu-history') {
        $list = [];
        try {
            $db = \OC::$server->getDatabaseConnection();
            $stmt = $db->executeQuery("SELECT protocollo, giorno, status, num_clients AS numClients, submitted_at AS submittedAt, submitted_by AS submittedBy, has_files AS hasFiles, 'Richiesta ministeriale CU' AS fileName FROM oc_studio_ade_cu_queue ORDER BY submitted_at DESC LIMIT 50");
            $list = $stmt->fetchAllAssociative();
        } catch (\Throwable) {
            try {
                $regNode = $root->get($base . '/CU/richieste.json');
                if ($regNode instanceof \OCP\Files\File) {
                    $list = json_decode($regNode->getContent(), true) ?: [];
                }
            } catch (\OCP\Files\NotFoundException) {}
        }
        reply(200, ['requests' => $list]);
    }

    // Clients list from Studio Dossier
    if ($method === 'GET' && $op === 'cu-clients') {
        $clients = [];
        try {
            $idxNode = null;
            try { $idxNode = $root->get('Studio/DossierClienti/private/dossier-index.json'); }
            catch (\Throwable) {
                try {
                    $adminFolder = \OC::$server->getUserFolder('admin');
                    $idxNode = $adminFolder->get('Studio/DossierClienti/private/dossier-index.json');
                } catch (\Throwable) {}
            }
            if ($idxNode instanceof \OCP\Files\File) {
                $raw = json_decode($idxNode->getContent(), true) ?: [];
                $items = $raw['dossiers'] ?? $raw['clients'] ?? (is_array($raw) ? $raw : []);
                foreach ($items as $k => $item) {
                    if (!is_array($item)) continue;
                    $id = $item['clientId'] ?? $item['id'] ?? (is_string($k) ? $k : '');
                    $ident = $item['identity'] ?? $item;
                    $name = $ident['displayName'] ?? $ident['denominazione'] ?? $ident['ragioneSociale'] ?? $ident['nome'] ?? $id;
                    $cf = strtoupper(trim((string)($ident['taxCode'] ?? $ident['codiceFiscale'] ?? '')));
                    $piva = strtoupper(trim((string)($ident['vatNumber'] ?? $ident['partitaIva'] ?? '')));
                    $isCompany = preg_match('/\b(S\.?R\.?L\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|S\.?P\.?A\.?|S\.?S\.?|S\.?A\.?P\.?A\.?|S\.?C\.?A\.?R\.?L\.?|S\.?C\.?R\.?L\.?|COOP\.?|COOPERATIVA|CONSORTILE|SOCIETA\'?|ASSOCIAZIONE|ASD)\b/i', $name) || preg_match('/^[0-9]{11}$/', $cf);
                    if ($isCompany) {
                        $type = 'PG';
                        $typeLabel = 'Società';
                        $eligible = false;
                    } else if (preg_match('/^[A-Z0-9]{16}$/', $cf)) {
                        if ($piva !== '') {
                            $type = 'DI';
                            $typeLabel = 'Ditta Individuale';
                            $eligible = true;
                        } else {
                            $type = 'PF';
                            $typeLabel = 'Persona Fisica';
                            $eligible = true;
                        }
                    } else {
                        continue;
                    }
                    $effectiveCf = ($isCompany && preg_match('/^[0-9]{11}$/', $piva)) ? $piva : $cf;
                    $clients[] = [
                        'id' => $id,
                        'name' => $name,
                        'taxCode' => $effectiveCf,
                        'vatNumber' => $piva,
                        'type' => $type,
                        'typeLabel' => $typeLabel,
                        'eligibleCu' => $eligible
                    ];
                }
            }
        } catch (\Throwable $e) {}
        // Sort alphabetically by name
        usort($clients, fn($a, $b) => strcasecmp($a['name'] ?? '', $b['name'] ?? ''));
        reply(200, ['clients' => $clients]);
    }

    // Download CU result files
    if ($method === 'GET' && $op === 'cu-download') {
        $protocollo = trim((string)($_GET['protocollo'] ?? ''));
        $type = (string)($_GET['type'] ?? 'ricevuta'); // 'ricevuta' or 'cu'
        if (!preg_match('/^[A-Za-z0-9\-]{5,40}$/', $protocollo)) reply(400, ['error' => 'Protocollo non valido.']);

        $folderPath = $base . '/CU/' . $protocollo;
        $dir = null;
        try {
            $dir = $root->get($folderPath);
        } catch (\Throwable) {
            try {
                $adminFolder = \OC::$server->getUserFolder('admin');
                $dir = $adminFolder->get($folderPath);
            } catch (\Throwable) {}
        }
        if (!$dir instanceof \OCP\Files\Folder) reply(404, ['error' => 'Cartella richiesta non trovata.']);

        $target = null;
        $prefix = $type === 'cu' ? 'CU_' : 'Ricevuta_';
        foreach ($dir->getDirectoryListing() as $fileNode) {
            if ($fileNode instanceof \OCP\Files\File && str_starts_with($fileNode->getName(), $prefix)) {
                $target = $fileNode;
                break;
            }
        }
        if (!$target instanceof \OCP\Files\File) reply(404, ['error' => 'File non disponibile.']);

        $isDownload = ($_GET['download'] ?? '') === '1';
        $mime = str_ends_with($target->getName(), '.pdf') ? 'application/pdf' : 'application/octet-stream';
        header('Content-Type: ' . $mime);
        header('Content-Disposition: ' . ($isDownload ? 'attachment' : 'inline') . '; filename="' . $target->getName() . '"');
        header('Content-Length: ' . $target->getSize());
        $stream = $target->fopen('r');
        if (!is_resource($stream)) throw new RuntimeException('File unavailable');
        fpassthru($stream); fclose($stream); exit;
    }

    // Audit Log viewer & exporter (GDPR compliance)
    if ($method === 'GET' && $op === 'audit-log') {
        $db = \OC::$server->getDatabaseConnection();
        $client = isset($_GET['client']) && $_GET['client'] !== '' ? taxcode($_GET['client']) : null;
        $format = (string)($_GET['format'] ?? 'json');

        $sql = "SELECT id, timestamp, user_id AS operator, client_cf AS client, operation, details, status, ip_address AS ip, row_hash AS hash FROM oc_studio_ade_audit ";
        $params = [];
        if ($client) {
            $sql .= "WHERE client_cf = ? ";
            $params[] = $client;
        }
        $sql .= "ORDER BY id DESC LIMIT 100";
        $logs = $db->executeQuery($sql, $params)->fetchAllAssociative();

        if ($format === 'csv') {
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="Audit_Log_Studio_AdE_' . date('Ymd_His') . '.csv"');
            $out = fopen('php://output', 'w');
            fputcsv($out, ['ID', 'Data/Ora (UTC)', 'Operatore', 'Codice Fiscale Cliente', 'Operazione', 'Dettagli', 'Esito', 'Indirizzo IP', 'Hash SHA256 (Integrita)']);
            foreach ($logs as $l) {
                fputcsv($out, [$l['id'], $l['timestamp'], $l['operator'], $l['client'] ?: '-', $l['operation'], $l['details'], $l['status'], $l['ip'], $l['hash']]);
            }
            fclose($out);
            exit;
        }

        reply(200, ['logs' => $logs]);
    }

    // Automated background polling for pending CU requests
    if ($method === 'GET' && $op === 'cu-poll-all') {
        $db = \OC::$server->getDatabaseConnection();
        $pending = $db->executeQuery("SELECT protocollo FROM oc_studio_ade_cu_queue WHERE status = 'in_elaborazione' ORDER BY submitted_at ASC LIMIT 5")->fetchAllAssociative();
        $updated = [];
        foreach ($pending as $item) {
            $proto = $item['protocollo'];
            try {
                [$st, $res] = ade_cu_get_esito($proto);
                if ($st === 200 && (!empty($res['file_ricevuta']) || !empty($res['file_cu']))) {
                    $targetDir = folder($root, $base . '/CU/' . $proto);
                    if (!empty($res['file_ricevuta'])) {
                        $rf = $targetDir->newFile('Ricevuta_' . $proto . '.pdf');
                        $rf->putContent(base64_decode($res['file_ricevuta']));
                    }
                    if (!empty($res['file_cu'])) {
                        $cf = $targetDir->newFile('CU_' . $proto . '.dat');
                        $cf->putContent(base64_decode($res['file_cu']));
                    }
                    $db->executeStatement("UPDATE oc_studio_ade_cu_queue SET status = 'completata', has_files = 1, esito_json = ?, updated_at = NOW() WHERE protocollo = ?", [json_encode($res, JSON_UNESCAPED_UNICODE), $proto]);
                    ade_audit_log($uid, null, 'cu-auto-poll', ['protocollo' => $proto, 'status' => 'completata'], 'ok');
                    $updated[] = ['protocollo' => $proto, 'status' => 'completata'];
                } elseif ($st === 429) {
                    break;
                }
            } catch (\Throwable) {}
        }
        reply(200, ['polled' => count($pending), 'completed' => $updated]);
    }

function ade_extract_f24_tributi(string $pdfBytes): array {
    preg_match_all('/stream\r?\n(.*?)\r?\nendstream/s', $pdfBytes, $m);
    if (empty($m[1])) return [];

    $contentStream = '';
    foreach ($m[1] as $s) {
        $d = @gzuncompress($s);
        if ($d && strpos($d, 'SEZIONE ERARIO') !== false) {
            $contentStream = $d;
            break;
        }
    }
    if (!$contentStream) return [];

    preg_match_all('/1 0 0 1 ([0-9\.\-]+) ([0-9\.\-]+) Tm\s*\(([^\)]*)\)/', $contentStream, $matches);
    $items = [];
    for ($i = 0; $i < count($matches[0]); $i++) {
        $x = floatval($matches[1][$i]);
        $y = floatval($matches[2][$i]);
        $text = trim($matches[3][$i]);
        if ($text === '' || $text === ',') continue;
        $items[] = ['x' => $x, 'y' => $y, 'text' => $text];
    }

    $rows = [];
    foreach ($items as $it) {
        $found = false;
        foreach ($rows as $idx => $group) {
            if (abs($group['y'] - $it['y']) <= 3.0) {
                $rows[$idx]['items'][] = $it;
                $found = true;
                break;
            }
        }
        if (!$found) {
            $rows[] = ['y' => $it['y'], 'items' => [$it]];
        }
    }

    $tributi = [];
    foreach ($rows as $row) {
        $y = $row['y'];
        $group = $row['items'];
        usort($group, fn($a, $b) => $a['x'] <=> $b['x']);

        $sezione = '';
        if ($y >= 540 && $y <= 630) $sezione = 'Erario';
        elseif ($y >= 435 && $y <= 510) $sezione = 'INPS';
        elseif ($y >= 365 && $y <= 430) $sezione = 'Regioni';
        elseif ($y >= 275 && $y <= 360) $sezione = 'IMU / Enti Locali';
        elseif ($y >= 195 && $y <= 270) $sezione = 'INAIL / Altri';

        if (!$sezione) continue;

        $codice = '';
        $rateazione = '';
        $anno = '';
        $debito = 0.0;
        $credito = 0.0;

        foreach ($group as $tok) {
            $t = preg_replace('/\s+/', '', $tok['text']);
            $x = $tok['x'];

            if ($x >= 140 && $x <= 205 && preg_match('/^[A-Za-z0-9]{3,5}$/', $t) && !preg_match('/^(?:TOTALE|SALDO|ANNO|DATA)$/i', $t)) {
                $codice = $t;
            } elseif ($x >= 210 && $x <= 250 && preg_match('/^\d{4}$/', $t)) {
                $rateazione = $t;
            } elseif ($x >= 250 && $x <= 300 && preg_match('/^(?:19|20)\d{2}$/', $t)) {
                $anno = $t;
            } elseif ($x >= 300 && $x <= 390 && preg_match('/^\d+(?:\s*\d+)?$/', $tok['text'])) {
                $numParts = preg_split('/\s+/', trim($tok['text']));
                $debito = count($numParts) === 2 ? floatval($numParts[0] . '.' . $numParts[1]) : floatval($numParts[0]);
            } elseif ($x >= 395 && $x <= 480 && preg_match('/^\d+(?:\s*\d+)?$/', $tok['text'])) {
                $numParts = preg_split('/\s+/', trim($tok['text']));
                $credito = count($numParts) === 2 ? floatval($numParts[0] . '.' . $numParts[1]) : floatval($numParts[0]);
            }
        }

        if ($codice && ($debito > 0 || $credito > 0)) {
            $tributi[] = [
                'sezione' => $sezione,
                'codice' => $codice,
                'rateazione' => $rateazione,
                'anno' => $anno,
                'debito' => $debito,
                'credito' => $credito,
                'saldo' => round($debito - $credito, 2)
            ];
        }
    }

    return $tributi;
}

    // F24 Multi-dimensional Analysis
    if ($method === 'GET' && $op === 'f24-analysis') {
        $client = taxcode($_GET['client'] ?? '');
        $models = [];
        $allTributi = [];
        $totDebito = 0.0;
        $totCredito = 0.0;

        try {
            $dir = $root->get($base . '/' . $client);
            if ($dir instanceof \OCP\Files\Folder) {
                foreach ($dir->getDirectoryListing() as $node) {
                    if ($node instanceof \OCP\Files\File && preg_match('/^[a-f0-9]{64}\.json$/D', $node->getName())) {
                        $meta = json_decode($node->getContent(), true);
                        if (is_array($meta) && ($meta['client'] ?? '') === $client && ($meta['kind'] ?? '') === 'f24') {
                            $id = $meta['id'] ?? substr($node->getName(), 0, 64);

                            // Check if tributi are cached in meta
                            if (empty($meta['tributi']) && $dir->nodeExists($id . '.pdf')) {
                                $pdfFile = $dir->get($id . '.pdf');
                                if ($pdfFile instanceof \OCP\Files\File) {
                                    $parsed = ade_extract_f24_tributi($pdfFile->getContent());
                                    if (!empty($parsed)) {
                                        $meta['tributi'] = $parsed;
                                        $node->putContent(json_encode($meta, JSON_UNESCAPED_UNICODE));
                                    }
                                }
                            }

                            $tributiList = $meta['tributi'] ?? [];
                            $modelDebito = 0.0;
                            $modelCredito = 0.0;

                            foreach ($tributiList as $tr) {
                                $deb = (float)($tr['debito'] ?? 0);
                                $cred = (float)($tr['credito'] ?? 0);
                                $modelDebito += $deb;
                                $modelCredito += $cred;
                                $totDebito += $deb;
                                $totCredito += $cred;

                                $allTributi[] = [
                                    'docId' => $id,
                                    'date' => $meta['date'] ?? $meta['acquiredAt'] ?? '',
                                    'year' => $meta['year'] ?? ($tr['anno'] ?? ''),
                                    'protocol' => $meta['protocol'] ?? '',
                                    'sezione' => $tr['sezione'] ?? 'Erario',
                                    'codice' => $tr['codice'] ?? '',
                                    'rateazione' => $tr['rateazione'] ?? '',
                                    'anno' => $tr['anno'] ?? ($meta['year'] ?? ''),
                                    'debito' => $deb,
                                    'credito' => $cred,
                                    'saldo' => round($deb - $cred, 2),
                                    'viewUrl' => '/studio-ade-api?op=document&client=' . urlencode($client) . '&id=' . urlencode($id)
                                ];
                            }

                            $rawBal = (string)($meta['balance'] ?? '');
                            $numBal = floatval(str_replace(['.', ','], ['', '.'], $rawBal));
                            $calcSaldo = round($modelDebito - $modelCredito, 2);
                            $isQuadrato = (count($tributiList) > 0 && ($rawBal === '' || abs($calcSaldo - $numBal) < 0.02));

                            $models[] = [
                                'docId' => $id,
                                'date' => $meta['date'] ?? '',
                                'year' => $meta['year'] ?? '',
                                'protocol' => $meta['protocol'] ?? '',
                                'balance' => $meta['balance'] ?? ($modelDebito > 0 || $modelCredito > 0 ? number_format($modelDebito - $modelCredito, 2, ',', '.') : '0,00'),
                                'debito' => $modelDebito,
                                'credito' => $modelCredito,
                                'saldo' => $calcSaldo,
                                'tributiCount' => count($tributiList),
                                'tributi' => $tributiList,
                                'quadrato' => $isQuadrato,
                                'viewUrl' => '/studio-ade-api?op=document&client=' . urlencode($client) . '&id=' . urlencode($id)
                            ];
                        }
                    }
                }
            }
        } catch (\Throwable) {}

        reply(200, [
            'client' => $client,
            'modelsCount' => count($models),
            'tributiCount' => count($allTributi),
            'totalDebito' => round($totDebito, 2),
            'totalCredito' => round($totCredito, 2),
            'saldoNetto' => round($totDebito - $totCredito, 2),
            'models' => $models,
            'tributi' => $allTributi
        ]);
    }

    // Existing archive ops
    if ($method === 'GET' && $op === 'archive') {
        $client = taxcode($_GET['client'] ?? ''); $docs = [];
        try {
            $dir = $root->get($base . '/' . $client);
            if ($dir instanceof \OCP\Files\Folder) foreach ($dir->getDirectoryListing() as $node) {
                if ($node instanceof \OCP\Files\File && preg_match('/^[a-f0-9]{64}\.json$/D', $node->getName())) {
                    $meta = json_decode($node->getContent(), true);
                    if (is_array($meta) && ($meta['client'] ?? '') === $client) $docs[] = $meta;
                }
            }
        } catch (\OCP\Files\NotFoundException) {}
        usort($docs, fn($a,$b)=>strcmp($b['acquiredAt'] ?? '', $a['acquiredAt'] ?? ''));
        reply(200, ['documents'=>$docs]);
    }
    if ($method === 'GET' && $op === 'document') {
        $client = taxcode($_GET['client'] ?? ''); $id = (string)($_GET['id'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/D', $id)) reply(400, ['error'=>'Documento non valido.']);
        $node = $root->get($base . '/' . $client . '/' . $id . '.pdf');
        if (!$node instanceof \OCP\Files\File) reply(404, ['error'=>'Documento non disponibile.']);
        header('Content-Type: application/pdf');
        header('Content-Disposition: ' . (($_GET['download'] ?? '') === '1' ? 'attachment' : 'inline') . '; filename="AdE-' . $client . '-' . substr($id,0,12) . '.pdf"');
        header('Content-Length: ' . $node->getSize());
        $stream = $node->fopen('r'); if (!is_resource($stream)) throw new RuntimeException('File unavailable');
        fpassthru($stream); fclose($stream); exit;
    }

    if ($method !== 'POST') reply(405, ['error'=>'Metodo non consentito.']);
    if (!\OC::$server->getRequest()->passesCSRFCheck()) reply(403, ['error'=>'Sessione scaduta. Ricarica l’app.']);

    // Setup Entratel security environment certificates
    if ($op === 'cu-certificates') {
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 1048576) reply(413,['error'=>'File troppo grandi: massimo 1 MB complessivo.']);
        $password=(string)($_POST['password'] ?? '');
        if ($password==='' || strlen($password)>1024) reply(400,['error'=>'Inserisci la password dell’ambiente di sicurezza.']);
        $certificates=[];$metadata=[];
        foreach (['firma','cifra'] as $role) {
            $upload=$_FILES[$role]??null;
            $bytes = null;
            if ($upload && ($upload['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK && ($upload['size'] ?? 0) <= 262144 && is_uploaded_file($upload['tmp_name'])) {
                $bytes = file_get_contents($upload['tmp_name']);
            } else {
                $stagedFile = $role === 'firma' ? '/var/www/html/config/staging_certs/UTEF.P12' : '/var/www/html/config/staging_certs/UTEC.P12';
                if (is_readable($stagedFile)) {
                    $bytes = file_get_contents($stagedFile);
                }
            }
            if (!$bytes) reply(400,['error'=>'Carica entrambi i certificati P12, oppure assicurati che i file UTEF.P12 e UTEC.P12 siano presenti.']);
            $keys=[];
            if (!@openssl_pkcs12_read($bytes,$keys,$password)) {
                $cmd = 'openssl pkcs12 -legacy -nodes -passin env:PASS';
                $proc = proc_open($cmd, [0=>['pipe','r'], 1=>['pipe','w'], 2=>['pipe','w']], $pipes, null, ['PASS'=>$password]);
                if (is_resource($proc)) {
                    fwrite($pipes[0], $bytes); fclose($pipes[0]);
                    $out = stream_get_contents($pipes[1]); fclose($pipes[1]);
                    fclose($pipes[2]);
                    if (proc_close($proc) === 0) {
                        if (preg_match('/(-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----)/', $out, $km)) $keys['pkey'] = $km[1];
                        if (preg_match('/(-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----)/', $out, $cm)) $keys['cert'] = $cm[1];
                    }
                }
            }
            if (empty($keys['cert']) || empty($keys['pkey']) || !openssl_x509_check_private_key($keys['cert'],$keys['pkey'])) {
                reply(400,['error'=>'Impossibile aprire il certificato di '.$role.'. Verifica che il file e la password dell’ambiente di sicurezza siano corretti.']);
            }
            $info=openssl_x509_parse($keys['cert']);
            if(!$info)reply(400,['error'=>'Certificato non leggibile.']);
            $valid=($info['validFrom_time_t']??PHP_INT_MAX)<=time()&&($info['validTo_time_t']??0)>time();
            $metadata[$role]=['subject'=>$info['subject']??[],'issuer'=>$info['issuer']??[],'validFrom'=>gmdate('Y-m-d',$info['validFrom_time_t']),'validTo'=>gmdate('Y-m-d',$info['validTo_time_t']),'validNow'=>$valid,'fingerprint'=>openssl_x509_fingerprint($keys['cert'],'sha256')];
            $certificates[$role]=base64_encode($bytes);unset($keys,$bytes);
        }
        $saved=false;
        if(($_POST['save']??'')==='1'){
            if(!$metadata['firma']['validNow']||!$metadata['cifra']['validNow'])reply(400,['error'=>'Certificati scaduti o non ancora validi: configurazione non salvata.','certificates'=>$metadata]);
            $key=ade_cu_get_kek();
            $iv=random_bytes(12);$tag='';
            $cipher=openssl_encrypt(json_encode(['certificates'=>$certificates,'password'=>$password,'metadata'=>$metadata,'configuredBy'=>$uid,'configuredAt'=>gmdate('c')]),'aes-256-gcm',$key,OPENSSL_RAW_DATA,$iv,$tag,'ade-cu-certificates-v1');
            if($cipher===false)throw new RuntimeException('Encryption failed');
            $dir='/var/www/html/config';$tmp=tempnam($dir,'ade-cu-');
            try{chmod($tmp,0600);if(file_put_contents($tmp,json_encode(['version'=>1,'iv'=>base64_encode($iv),'tag'=>base64_encode($tag),'ciphertext'=>base64_encode($cipher)]))===false||!rename($tmp,$dir.'/ade-cu-certificates.json'))throw new RuntimeException('Save failed');}finally{if(is_file($tmp))unlink($tmp);}
            $saved=true;unset($key,$cipher);
        }
        unset($password,$certificates);
        reply(200,['certificates'=>$metadata,'saved'=>$saved,'message'=>$saved?'Configurazione cifrata salvata. Collegamento CU pronto per il collaudo.':'Certificati letti con successo. Controlla intestatario e scadenza prima di confermare.']);
    }

    // Direct generation & submission of CU request without Desktop Telematico
    if ($op === 'cu-generate-submit') {
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 131072) reply(413, ['error' => 'Richiesta troppo grande.']);
        $input = json_decode(file_get_contents('php://input', false, null, 0, 131073), true);
        if (!is_array($input) || empty($input['taxCodes']) || !is_array($input['taxCodes'])) {
            reply(400, ['error' => 'Seleziona almeno un codice fiscale di persona fisica per la richiesta CU.']);
        }

        $taxCodes = array_values(array_unique(array_filter(array_map('trim', $input['taxCodes']))));
        if (empty($taxCodes)) {
            reply(400, ['error' => 'Nessun codice fiscale valido specificato.']);
        }

        $creds = ade_cu_load_credentials();
        $fornitore = trim((string)($input['fornitore'] ?? $creds['cf']));
        $richiedente = trim((string)($input['richiedente'] ?? '00000000000'));
        $denominazione = trim((string)($input['denominazione'] ?? 'STUDIO ASSOCIATO studio-example'));
        $email = trim((string)($input['email'] ?? 'info@studio.example'));

        try {
            $db = \OC::$server->getDatabaseConnection();
            $cnt = (int)$db->executeQuery(
                "SELECT COUNT(*) FROM oc_studio_ade_cu_queue WHERE giorno = CURRENT_DATE() AND intermediario_cf = ? AND status IN ('submitted', 'in_elaborazione', 'completata')",
                [$richiedente]
            )->fetchOne();
            if ($cnt >= 2) {
                reply(429, ['error' => 'Limite di richieste CU raggiunto per oggi (massimo 2 al giorno per intermediario). Riprova domani.']);
            }
        } catch (\Throwable) {}

        try {
            $rcu = ade_cu_build_rcu($taxCodes, [
                'fornitore' => $fornitore,
                'richiedente' => $richiedente,
                'denominazione' => $denominazione,
                'email' => $email
            ]);
            $ccf = ade_cu_build_ccf($rcu);
        } catch (\Throwable $e) {
            reply(400, ['error' => 'Errore composizione fornitura CU: ' . $e->getMessage()]);
        }

        \OC::$server->getSession()->close();
        [$status, $data] = ade_cu_send_request($ccf);

        if ($status === 200 && !empty($data['protocollo'])) {
            try {
                $db = \OC::$server->getDatabaseConnection();
                $db->executeStatement(
                    "INSERT INTO oc_studio_ade_cu_queue (protocollo, intermediario_cf, giorno, status, num_clients, tax_codes_json, submitted_at, submitted_by, updated_at) VALUES (?, ?, CURRENT_DATE(), 'in_elaborazione', ?, ?, NOW(), ?, NOW())",
                    [$data['protocollo'], $richiedente, count($taxCodes), json_encode($taxCodes), $uid]
                );
            } catch (\Throwable) {}
            ade_audit_log($uid, null, 'cu-generate-submit', ['protocollo' => $data['protocollo'], 'numClients' => count($taxCodes), 'taxCodes' => $taxCodes], 'ok');

            $cuFolder = folder($root, $base . '/CU');
            $regList = [];
            try {
                $regNode = $cuFolder->get('richieste.json');
                if ($regNode instanceof \OCP\Files\File) $regList = json_decode($regNode->getContent(), true) ?: [];
            } catch (\OCP\Files\NotFoundException) {}

            $entry = [
                'protocollo' => $data['protocollo'],
                'fileName' => 'Richiesta_Diretta_' . count($taxCodes) . '_CF.ccf',
                'submittedAt' => gmdate('c'),
                'submittedBy' => $uid,
                'status' => 'in_elaborazione',
                'numClients' => count($taxCodes),
                'taxCodes' => $taxCodes,
                'messaggio' => $data['messaggio'] ?? 'Inviata con successo all’Agenzia delle Entrate'
            ];
            array_unshift($regList, $entry);

            try {
                $tmp = $cuFolder->newFile('richieste.tmp');
                $tmp->putContent(json_encode($regList, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
                try { $cuFolder->get('richieste.json')->delete(); } catch (\OCP\Files\NotFoundException) {}
                $tmp->move($cuFolder->getPath() . '/richieste.json');
            } catch (\Throwable) {}

            $data['numClients'] = count($taxCodes);
        }
        reply($status, $data);
    }

    // Direct generation & download of RCU file for Desktop Telematico
    if ($op === 'cu-generate-rcu') {
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 131072) reply(413, ['error' => 'Richiesta troppo grande.']);
        $input = json_decode(file_get_contents('php://input', false, null, 0, 131073), true);
        if (!is_array($input) || empty($input['taxCodes']) || !is_array($input['taxCodes'])) {
            reply(400, ['error' => 'Seleziona almeno un codice fiscale per la fornitura RCU.']);
        }
        $taxCodes = array_values(array_unique(array_filter(array_map('trim', $input['taxCodes']))));
        if (empty($taxCodes)) reply(400, ['error' => 'Nessun codice fiscale valido specificato.']);

        $creds = ade_cu_load_credentials();
        $fornitore = trim((string)($input['fornitore'] ?? $creds['cf']));
        $richiedente = trim((string)($input['richiedente'] ?? '00000000000'));
        $denominazione = trim((string)($input['denominazione'] ?? 'STUDIO ASSOCIATO studio-example'));
        $email = trim((string)($input['email'] ?? 'info@studio.example'));

        try {
            $rcu = ade_cu_build_rcu($taxCodes, [
                'fornitore' => $fornitore,
                'richiedente' => $richiedente,
                'denominazione' => $denominazione,
                'email' => $email
            ]);
        } catch (\Throwable $e) {
            reply(400, ['error' => 'Errore composizione RCU: ' . $e->getMessage()]);
        }
        ade_audit_log($uid, null, 'cu-generate-rcu', ['numClients' => count($taxCodes)], 'ok');
        header('Content-Type: text/plain; charset=iso-8859-1');
        header('Content-Disposition: attachment; filename="' . $richiedente . '_RCU26.rcu"');
        header('Content-Length: ' . strlen($rcu));
        echo $rcu;
        exit;
    }

    // Submit CU request file (.ccf / .rcu)
    if ($op === 'cu-submit') {
        $upload = $_FILES['file'] ?? null;
        if (!$upload || $upload['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($upload['tmp_name'])) {
            reply(400, ['error' => 'Seleziona un file di richiesta (.ccf o .rcu) valido.']);
        }
        $fileBytes = file_get_contents($upload['tmp_name']);
        if (str_ends_with(strtolower($upload['name']), '.rcu') || !str_starts_with($fileBytes, 'RCU26****')) {
            try {
                $fileBytes = ade_cu_build_ccf($fileBytes);
            } catch (\Throwable $e) {
                reply(400, ['error' => 'Errore autenticazione automatica file telematico: ' . $e->getMessage()]);
            }
        }
        if (strlen($fileBytes) < 50 || strlen($fileBytes) > 5242880) {
            reply(400, ['error' => 'Dimensione del file di richiesta non valida (massimo 5 MB).']);
        }

        \OC::$server->getSession()->close();
        [$status, $data] = ade_cu_send_request($fileBytes);

        if ($status === 200 && !empty($data['protocollo'])) {
            try {
                $db = \OC::$server->getDatabaseConnection();
                $db->executeStatement(
                    "INSERT INTO oc_studio_ade_cu_queue (protocollo, intermediario_cf, giorno, status, num_clients, tax_codes_json, submitted_at, submitted_by, updated_at) VALUES (?, '00000000000', CURRENT_DATE(), 'in_elaborazione', 1, ?, NOW(), ?, NOW())",
                    [$data['protocollo'], json_encode(['file' => $upload['name']]), $uid]
                );
            } catch (\Throwable) {}
            ade_audit_log($uid, null, 'cu-submit', ['protocollo' => $data['protocollo'], 'fileName' => $upload['name']], 'ok');

            $cuFolder = folder($root, $base . '/CU');
            $regList = [];
            try {
                $regNode = $cuFolder->get('richieste.json');
                if ($regNode instanceof \OCP\Files\File) $regList = json_decode($regNode->getContent(), true) ?: [];
            } catch (\OCP\Files\NotFoundException) {}

            $entry = [
                'protocollo' => $data['protocollo'],
                'fileName' => $upload['name'],
                'submittedAt' => gmdate('c'),
                'submittedBy' => $uid,
                'status' => 'in_elaborazione',
                'messaggio' => $data['messaggio'] ?? 'Inviata con successo'
            ];
            array_unshift($regList, $entry);

            try {
                $tmp = $cuFolder->newFile('richieste.tmp');
                $tmp->putContent(json_encode($regList, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
                try { $cuFolder->get('richieste.json')->delete(); } catch (\OCP\Files\NotFoundException) {}
                $tmp->move($cuFolder->getPath() . '/richieste.json');
            } catch (\Throwable) {}
        }
        reply($status, $data);
    }

    // Check / retrieve CU esito
    if ($op === 'cu-esito') {
        $input = json_decode(file_get_contents('php://input', false, null, 0, 16385), true);
        if (!is_array($input) || empty($input['protocollo'])) {
            reply(400, ['error' => 'Specifica il protocollo telematico da controllare.']);
        }
        $protocollo = trim((string)$input['protocollo']);

        // Return cached result if already completed in DB
        try {
            $db = \OC::$server->getDatabaseConnection();
            $existing = $db->executeQuery("SELECT status, has_files, esito_json FROM oc_studio_ade_cu_queue WHERE protocollo = ?", [$protocollo])->fetchAssociative();
            if ($existing && $existing['status'] === 'completata' && !empty($existing['esito_json'])) {
                $data = json_decode($existing['esito_json'], true) ?: [];
                $data['status'] = 'completata';
                $data['hasFiles'] = (bool)$existing['has_files'];
                $data['receiptUrl'] = '/studio-ade-api?op=cu-download&protocollo=' . urlencode($protocollo) . '&type=ricevuta';
                if (!empty($data['file_cu'])) {
                    $data['cuUrl'] = '/studio-ade-api?op=cu-download&protocollo=' . urlencode($protocollo) . '&type=cu';
                }
                reply(200, $data);
            }
        } catch (\Throwable) {}

        \OC::$server->getSession()->close();
        [$status, $data] = ade_cu_get_esito($protocollo);

        // If 200 completed, save files in Nextcloud
        if ($status === 200 && (!empty($data['file_ricevuta']) || !empty($data['file_cu']))) {
            $targetDir = folder($root, $base . '/CU/' . $protocollo);
            if (!empty($data['file_ricevuta'])) {
                $rBytes = base64_decode($data['file_ricevuta']);
                try {
                    try { $targetDir->get('Ricevuta_' . $protocollo . '.pdf')->delete(); } catch (\OCP\Files\NotFoundException) {}
                    $rf = $targetDir->newFile('Ricevuta_' . $protocollo . '.pdf');
                    $rf->putContent($rBytes);
                } catch (\Throwable) {}
            }
            if (!empty($data['file_cu'])) {
                $cBytes = base64_decode($data['file_cu']);
                try {
                    try { $targetDir->get('CU_' . $protocollo . '.dat')->delete(); } catch (\OCP\Files\NotFoundException) {}
                    $cf = $targetDir->newFile('CU_' . $protocollo . '.dat');
                    $cf->putContent($cBytes);
                } catch (\Throwable) {}
            }
            // Update MariaDB registry
            try {
                $db = \OC::$server->getDatabaseConnection();
                $db->executeStatement(
                    "UPDATE oc_studio_ade_cu_queue SET status = 'completata', has_files = 1, esito_json = ?, updated_at = NOW() WHERE protocollo = ?",
                    [json_encode($data, JSON_UNESCAPED_UNICODE), $protocollo]
                );
            } catch (\Throwable) {}
            ade_audit_log($uid, null, 'cu-esito', ['protocollo' => $protocollo, 'status' => 'completata'], 'ok');

            // Update legacy file registry
            try {
                $cuFolder = folder($root, $base . '/CU');
                $regNode = $cuFolder->get('richieste.json');
                if ($regNode instanceof \OCP\Files\File) {
                    $regList = json_decode($regNode->getContent(), true) ?: [];
                    foreach ($regList as &$item) {
                        if (($item['protocollo'] ?? '') === $protocollo) {
                            $item['status'] = 'completata';
                            $item['completedAt'] = gmdate('c');
                        }
                    }
                    $regNode->putContent(json_encode($regList, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
                }
            } catch (\Throwable) {}

            $data['hasFiles'] = true;
            $data['receiptUrl'] = '/studio-ade-api?op=cu-download&protocollo=' . urlencode($protocollo) . '&type=ricevuta';
            $data['cuUrl'] = '/studio-ade-api?op=cu-download&protocollo=' . urlencode($protocollo) . '&type=cu';
        }
        reply($status, $data);
    }

    // Check generic JSON POST operations (connector & verify)
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 65536) reply(413, ['error'=>'Richiesta troppo grande.']);
    $input = json_decode(file_get_contents('php://input', false, null, 0, 65537), true);
    if (!is_array($input)) reply(400, ['error'=>'Richiesta non valida.']);

    // Entratel portal connector operations
    $connectorOps = ['status', 'login', 'logout', 'job', 'ack', 'f24-list', 'f24-download', 'declaration-download', 'document-types', 'document-years', 'invoices-open', 'circuit-status', 'circuit-reset'];
    if (in_array($input['op'] ?? '', $connectorOps, true)) {
        if (!is_readable('/var/www/html/config/ade-connector.key')) reply(503, ['error'=>'Connettore Entratel non configurato.']);
        $key = trim(file_get_contents('/var/www/html/config/ade-connector.key'));
        $sid = hash_hmac('sha256', $uid . ':' . \OC::$server->getSession()->getId(), $key);
        \OC::$server->getSession()->close();
        $curl = curl_init('http://studio-ade-connector:8787/command');
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($input),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-Connector-Key: ' . $key,
                'X-Connector-Session: ' . $sid
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 40
        ]);
        $raw = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        unset($input['credentials']);
        if ($raw === false || !$status) reply(503, ['error'=>'Connettore Entratel non raggiungibile.']);
        $data = json_decode($raw, true); unset($raw);
        if (!is_array($data)) reply(502, ['error'=>'Risposta connettore Entratel non valida.']);

        if (($data['state'] ?? '') === 'complete' && isset($data['result']['file'])) {
            $result = $data['result'];
            $meta = $result['metadata'] ?? [];
            $file = $result['file'];
            $client = taxcode($meta['client'] ?? '');
            $bytes = base64_decode((string)($file['content'] ?? ''), true);
            if ($bytes === false || strlen($bytes) > 20*1024*1024 || !str_starts_with($bytes, '%PDF-')) {
                reply(502, ['error'=>'Documento ricevuto non valido.']);
            }
            $id = hash('sha256', $bytes);
            if (!hash_equals($id, (string)($file['sha256'] ?? ''))) {
                reply(502, ['error'=>'Verifica integrità documento fallita.']);
            }
            $dir = folder($root, $base . '/' . $client);

            // Preserve distinct documents and versions; deduplicate only identical bytes.
            $kind = (string)($meta['kind'] ?? '');
            if (!$dir->nodeExists($id . '.pdf')) $dir->newFile($id . '.pdf', $bytes);
            $meta['id'] = $id;
            $meta['filename'] = 'AdE-' . $client . '-' . substr($id, 0, 12) . '.pdf';
            $meta['mime'] = 'application/pdf';
            $parsedTr = [];
            if ($kind === 'f24') {
                $parsedTr = ade_extract_f24_tributi($bytes);
                if (!empty($parsedTr)) $meta['tributi'] = $parsedTr;
            }
            if (!$dir->nodeExists($id . '.json')) {
                $dir->newFile($id . '.json', json_encode($meta, JSON_UNESCAPED_UNICODE));
            } else {
                $meta = json_decode($dir->get($id . '.json')->getContent(), true);
                if (!empty($parsedTr) && empty($meta['tributi'])) {
                    $meta['tributi'] = $parsedTr;
                    $dir->get($id . '.json')->putContent(json_encode($meta, JSON_UNESCAPED_UNICODE));
                }
            }
            $data['result'] = ['saved' => true, 'document' => $meta];
        }
        $auditOps = ['f24-list', 'f24-download', 'declaration-download', 'invoices-open', 'login', 'circuit-reset'];
        if (in_array($input['op'] ?? '', $auditOps, true)) {
            $clientCf = isset($input['client']) ? taxcode($input['client']) : null;
            $details = [
                'model' => $input['model'] ?? null,
                'year' => $input['year'] ?? null,
                'protocol' => $input['protocol'] ?? null,
                'direction' => $input['direction'] ?? null,
                'action' => ($input['op'] === 'circuit-reset') ? 'Ripristino manuale salvavita connettore' : null
            ];
            ade_audit_log($uid, $clientCf, $input['op'], array_filter($details), ($status >= 200 && $status < 300) ? 'ok' : 'error');
        }
        reply($status, $data);
    }

    // Official verify endpoint
    if (($input['op'] ?? '') === 'verify') {
        \OC::$server->getSession()->close();
        [$status,$data] = ade_verify((string)($input['kind'] ?? ''),(string)($input['value'] ?? ''));
        if(isset($data['retryAfter'])) header('Retry-After: '.(int)$data['retryAfter']);
        reply($status,$data);
    }

    reply(400, ['error'=>'Operazione non disponibile.']);
} catch (\OCP\Files\NotFoundException) { reply(404, ['error'=>'Documento non disponibile.']); }
catch (\OCP\Files\NotPermittedException) { reply(403, ['error'=>'Non hai il permesso per questa operazione.']); }
catch (Throwable $e) { reply(500, ['error'=>'Operazione non completata. Verifica sessione e disponibilità dell’archivio Nextcloud. ' . $e->getMessage()]); }
