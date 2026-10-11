<?php
declare(strict_types=1);

const RAG_BACKEND = 'http://127.0.0.1:5055';
const NEXTCLOUD_ROOT = '/var/www/html';
const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

function fail_json(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => false, 'error' => $message], JSON_FLAGS);
    exit;
}

function uuid_v7(): string {
    $time = str_pad(dechex((int)floor(microtime(true) * 1000)), 12, '0', STR_PAD_LEFT);
    $random = bin2hex(random_bytes(10));
    $variant = dechex((hexdec($random[3]) & 0x3) | 0x8);
    return substr($time, 0, 8) . '-' . substr($time, 8, 4) . '-7' . substr($random, 0, 3)
        . '-' . $variant . substr($random, 4, 3) . '-' . substr($random, 7, 12);
}

function current_user_via_ocs(): string {
    $cookie = (string)($_SERVER['HTTP_COOKIE'] ?? '');
    if ($cookie === '') fail_json(401, 'Utente Nextcloud non autenticato');
    $host = preg_replace('/[^a-zA-Z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'cloud.studio.example'));
    $ch = curl_init('http://127.0.0.1/ocs/v2.php/cloud/user?format=json');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Accept: application/json',
        'OCS-APIRequest: true',
        'Cookie: ' . $cookie,
        'Host: ' . $host,
    ]);
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0;
    curl_close($ch);
    if ($status === 401 || $status === 403) fail_json(401, 'Sessione Nextcloud assente o scaduta');
    if ($status !== 200 || !is_string($response)) fail_json(503, 'Verifica sessione Nextcloud non disponibile');
    $payload = json_decode($response, true);
    $uid = (string)($payload['ocs']['data']['id'] ?? '');
    if ($uid === '') fail_json(401, 'Sessione Nextcloud non valida');
    return $uid;
}

function audit_event(string $eventType, string $outcome, string $uid, string $notebook = '', array $metrics = [], string $reason = ''): void {
    try {
        $dir = NEXTCLOUD_ROOT . '/data/.studio-audit';
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) return;
        $event = [
            'schemaVersion' => '1.0.0',
            'eventId' => uuid_v7(),
            'occurredAt' => gmdate('c'),
            'correlationId' => $GLOBALS['ragCorrelationId'] ?? uuid_v7(),
            'actor' => ['userId' => $uid !== '' ? $uid : 'anonymous'],
            'appId' => 'rag-studio',
            'eventType' => $eventType,
            'outcome' => $outcome,
            'target' => ['type' => 'notebook', 'id' => $notebook !== '' ? $notebook : 'none'],
            'metrics' => $metrics,
            'privacyClass' => 'confidential',
        ];
        if ($reason !== '') $event['reasonCode'] = preg_replace('/[^a-z0-9_.-]/i', '', $reason);
        $file = $dir . '/' . gmdate('Y-m-d') . '.jsonl';
        file_put_contents($file, json_encode($event, JSON_FLAGS) . "\n", FILE_APPEND | LOCK_EX);
        @chmod($file, 0600);
    } catch (Throwable) {
        // L'audit non deve esporre dettagli né interrompere indiscriminatamente il servizio.
    }
}

function base64url_encode(string $value): string {
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function base64url_decode(string $value): string|false {
    $padding = strlen($value) % 4;
    if ($padding) $value .= str_repeat('=', 4 - $padding);
    return base64_decode(strtr($value, '-_', '+/'), true);
}

function current_index_version(string $notebook): string {
    $safe = preg_replace('/[^a-zA-Z0-9._-]/', '', $notebook);
    $index = NEXTCLOUD_ROOT . '/rag-cloud/indexes/' . $safe . '/index.json';
    $fallback = NEXTCLOUD_ROOT . '/rag-cloud/notebooks.json';
    $mtime = is_file($index) ? filemtime($index) : (is_file($fallback) ? filemtime($fallback) : 0);
    return hash('sha256', $safe . '|' . (string)$mtime);
}

function source_token(string $path, array $context, array $tokenConfig): string {
    $keyId = (string)$tokenConfig['active_key'];
    $secret = (string)$tokenConfig['keys'][$keyId];
    $key = hash('sha256', $secret, true);
    $iv = random_bytes(12);
    $tag = '';
    $now = time();
    $claims = [
        'v' => 2,
        'uid' => $context['uid'],
        'notebook' => $context['notebook'],
        'index' => $context['index'],
        'operation' => 'select-source',
        'iat' => $now,
        'exp' => $now + 900,
        'path' => $path,
    ];
    $aad = 'studio-example-rag-source-v2|' . $keyId;
    $ciphertext = openssl_encrypt(
        json_encode($claims, JSON_FLAGS),
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag,
        $aad
    );
    if ($ciphertext === false) fail_json(500, 'Protezione identificativo fonte non disponibile');
    return $keyId . '.' . base64url_encode($iv . $tag . $ciphertext);
}

function source_from_token(string $token, array $context, array $tokenConfig): string|false {
    $parts = explode('.', $token, 2);
    if (count($parts) !== 2) return false;
    [$keyId, $encoded] = $parts;
    $secret = $tokenConfig['keys'][$keyId] ?? null;
    if (!is_string($secret) || $secret === '') return false;
    $packed = base64url_decode($encoded);
    if ($packed === false || strlen($packed) < 29) return false;
    $iv = substr($packed, 0, 12);
    $tag = substr($packed, 12, 16);
    $ciphertext = substr($packed, 28);
    $key = hash('sha256', $secret, true);
    $plaintext = openssl_decrypt(
        $ciphertext,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag,
        'studio-example-rag-source-v2|' . $keyId
    );
    if ($plaintext === false) return false;
    $claims = json_decode($plaintext, true);
    if (!is_array($claims)) return false;
    if (($claims['v'] ?? 0) !== 2 || ($claims['operation'] ?? '') !== 'select-source') return false;
    if (!hash_equals((string)$context['uid'], (string)($claims['uid'] ?? ''))) return false;
    if (!hash_equals((string)$context['notebook'], (string)($claims['notebook'] ?? ''))) return false;
    if (!hash_equals((string)$context['index'], (string)($claims['index'] ?? ''))) return false;
    if ((int)($claims['exp'] ?? 0) < time() || (int)($claims['iat'] ?? 0) > time() + 30) return false;
    return is_string($claims['path'] ?? null) ? $claims['path'] : false;
}

function sanitize_payload(mixed $value, array $context, array $tokenConfig): mixed {
    if (!is_array($value)) return $value;
    $result = [];
    foreach ($value as $key => $item) {
        if (is_int($key)) {
            $result[] = sanitize_payload($item, $context, $tokenConfig);
            continue;
        }
        if (in_array($key, ['original_path', 'md_dir', 'source_dir', 'nextcloud_scan_path', 'factory_run', 'index'], true)) {
            continue;
        }
        if ($key === 'source_path' && is_string($item) && $item !== '') {
            $result['source_token'] = source_token($item, $context, $tokenConfig);
            continue;
        }
        if (in_array($key, ['source_paths', 'selected_sources'], true) && is_array($item)) {
            $result['source_tokens'] = array_values(array_map(
                fn($path) => source_token((string)$path, $context, $tokenConfig),
                array_filter($item, fn($path) => is_string($path) && $path !== '')
            ));
            continue;
        }
        if ($key === 'copied' && is_array($item)) {
            $result[$key] = array_values(array_map(fn($path) => basename((string)$path), $item));
            continue;
        }
        $result[$key] = sanitize_payload($item, $context, $tokenConfig);
    }
    return $result;
}

function check_rate_limit(string $uid, string $endpoint): void {
    $limit = str_contains($endpoint, '/ask') ? 12 : 40;
    $window = 60;
    $key = hash('sha256', $uid . '|' . $endpoint);
    $file = sys_get_temp_dir() . '/studio-example-rag-rate-' . $key . '.json';
    $handle = fopen($file, 'c+');
    if (!$handle) fail_json(503, 'Controllo richieste temporaneamente non disponibile');
    flock($handle, LOCK_EX);
    $raw = stream_get_contents($handle);
    $state = json_decode($raw ?: '{}', true) ?: [];
    $now = time();
    if (($state['start'] ?? 0) <= $now - $window) $state = ['start' => $now, 'count' => 0];
    $state['count'] = (int)($state['count'] ?? 0) + 1;
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($state));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    if ($state['count'] > $limit) fail_json(429, 'Troppe richieste RAG. Attendi un minuto e riprova.');
}

$GLOBALS['ragCorrelationId'] = uuid_v7();
$uid = current_user_via_ocs();

$configFile = NEXTCLOUD_ROOT . '/config/rag-access.php';
if (!is_file($configFile)) fail_json(503, 'Configurazione accessi RAG non disponibile');
$config = require $configFile;
$tokenConfig = (array)($config['tokens'] ?? []);
$activeKey = (string)($tokenConfig['active_key'] ?? '');
$tokenKeys = (array)($tokenConfig['keys'] ?? []);
$users = (array)($config['users'] ?? []);
$userConfig = $users[$uid] ?? null;
if (!is_array($userConfig) || $activeKey === '' || !isset($tokenKeys[$activeKey])) {
    audit_event('authorization.denied', 'denied', $uid, '', [], 'user_not_allowed');
    fail_json(403, 'Utente non autorizzato al RAG');
}
$allowedNotebooks = array_values((array)($userConfig['notebooks'] ?? []));
$isRagAdmin = !empty($userConfig['admin']);

$path = (string)($_GET['route'] ?? '');
$path = '/' . ltrim((string)(parse_url($path, PHP_URL_PATH) ?: ''), '/');
$allowedEndpoints = [
    '/api/status', '/api/notebooks', '/api/models', '/api/sources',
    '/api/retrieve', '/api/ask', '/api/digest',
    '/api/admin/folders', '/api/admin/folder/create',
    '/api/admin/notebook/save', '/api/admin/notebook/disable'
];
if (!in_array($path, $allowedEndpoints, true)) fail_json(404, 'Endpoint RAG non disponibile');

if (str_starts_with($path, '/api/admin/') && !$isRagAdmin) {
    audit_event('rag.admin.denied', 'denied', $uid, '', [], 'admin_required');
    fail_json(403, 'Gestione notebook riservata agli amministratori RAG');
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$rawBody = file_get_contents('php://input') ?: '';
$bodyData = $rawBody === '' ? [] : json_decode($rawBody, true);
if (!is_array($bodyData)) fail_json(400, 'Payload JSON non valido');

if ($method !== 'GET') {
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    $expectedOrigin = 'https://' . (string)($_SERVER['HTTP_HOST'] ?? '');
    if ($origin !== '' && !hash_equals($expectedOrigin, $origin)) fail_json(403, 'Origine richiesta non autorizzata');
    if (!hash_equals('1', (string)($_SERVER['HTTP_X_STUDIO_RAG'] ?? ''))) {
        audit_event('authorization.denied', 'denied', $uid, '', [], 'csrf_header_missing');
        fail_json(403, 'Richiesta applicativa non valida');
    }
}

$notebook = trim((string)($bodyData['notebook'] ?? $_GET['notebook'] ?? ''));
$tokenContext = ['uid' => $uid, 'notebook' => $notebook, 'index' => current_index_version($notebook)];

if (isset($bodyData['source_tokens'])) {
    $paths = [];
    foreach ((array)$bodyData['source_tokens'] as $token) {
        $decoded = source_from_token((string)$token, $tokenContext, $tokenConfig);
        if ($decoded === false) {
            audit_event('authorization.denied', 'denied', $uid, $notebook, [], 'source_token_invalid');
            fail_json(400, 'Selezione fonte non valida o scaduta');
        }
        $paths[] = $decoded;
    }
    $bodyData['source_paths'] = $paths;
    unset($bodyData['source_tokens']);
    $rawBody = json_encode($bodyData, JSON_FLAGS);
}

if ($notebook !== '' && !in_array('*', $allowedNotebooks, true) && !in_array($notebook, $allowedNotebooks, true)) {
    audit_event('rag.query.denied', 'denied', $uid, $notebook, [], 'notebook_not_allowed');
    fail_json(403, 'Notebook non autorizzato per questo utente');
}
if ($path === '/api/digest' && !$isRagAdmin) {
    audit_event('rag.index.rebuild.denied', 'denied', $uid, $notebook, [], 'admin_required');
    fail_json(403, 'Rigenerazione indici riservata agli amministratori RAG');
}

check_rate_limit($uid, $path);

$concurrencyHandle = null;
$globalConcurrencyHandle = null;
if (in_array($path, ['/api/ask', '/api/digest'], true)) {
    $lockFile = sys_get_temp_dir() . '/studio-example-rag-job-' . hash('sha256', $uid) . '.lock';
    $concurrencyHandle = fopen($lockFile, 'c');
    if (!$concurrencyHandle || !flock($concurrencyHandle, LOCK_EX | LOCK_NB)) {
        if (is_resource($concurrencyHandle)) fclose($concurrencyHandle);
        fail_json(429, 'Hai già una richiesta RAG in elaborazione. Attendi il completamento.');
    }
}

if (in_array($path, ['/api/ask', '/api/digest'], true)) {
    $globalConcurrencyHandle = fopen(sys_get_temp_dir() . '/studio-example-rag-global.lock', 'c');
    if (!$globalConcurrencyHandle || !flock($globalConcurrencyHandle, LOCK_EX | LOCK_NB)) {
        if (is_resource($globalConcurrencyHandle)) fclose($globalConcurrencyHandle);
        if (is_resource($concurrencyHandle)) {
            flock($concurrencyHandle, LOCK_UN);
            fclose($concurrencyHandle);
        }
        audit_event('rag.query.denied', 'denied', $uid, $notebook, [], 'global_capacity');
        fail_json(429, 'Il RAG sta elaborando un’altra richiesta. Riprova tra poco.');
    }
}

$startedAt = microtime(true);
if ($path === '/api/digest') audit_event('rag.index.rebuild.started', 'started', $uid, $notebook);

$backendQuery = $_GET;
unset($backendQuery['route']);
$query = http_build_query($backendQuery);
$target = RAG_BACKEND . $path . ($query !== '' ? '?' . $query : '');
$headers = ['Content-Type: application/json; charset=utf-8'];
$ch = curl_init($target);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
curl_setopt($ch, CURLOPT_TIMEOUT, 240);
if ($rawBody !== '' && $method !== 'GET') curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
$response = curl_exec($ch);
if ($response === false) {
    curl_close($ch);
    fail_json(503, 'Server RAG temporaneamente non raggiungibile');
}
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 502;
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE) ?: 0;
$payload = substr($response, $headerSize);
curl_close($ch);
if (is_resource($concurrencyHandle)) {
    flock($concurrencyHandle, LOCK_UN);
    fclose($concurrencyHandle);
}
if (is_resource($globalConcurrencyHandle)) {
    flock($globalConcurrencyHandle, LOCK_UN);
    fclose($globalConcurrencyHandle);
}
$data = json_decode($payload, true);
if (!is_array($data)) fail_json(502, 'Risposta RAG non valida');

if ($path === '/api/notebooks' && isset($data['notebooks']) && is_array($data['notebooks']) && !in_array('*', $allowedNotebooks, true)) {
    $data['notebooks'] = array_values(array_filter(
        $data['notebooks'],
        fn($item) => is_array($item) && in_array((string)($item['name'] ?? ''), $allowedNotebooks, true)
    ));
    if (!in_array((string)($data['default_notebook'] ?? ''), $allowedNotebooks, true)) {
        $data['default_notebook'] = $allowedNotebooks[0] ?? '';
    }
}
$data['access'] = ['user' => $uid, 'can_digest' => $isRagAdmin];
$durationMs = (int)round((microtime(true) - $startedAt) * 1000);
$sourceCount = isset($data['hits']) && is_array($data['hits']) ? count($data['hits']) : 0;
if ($path === '/api/ask') {
    audit_event('rag.query.completed', $status < 400 ? 'success' : 'failure', $uid, $notebook, [
        'durationMs' => $durationMs,
        'sourceCount' => $sourceCount,
    ]);
} elseif ($path === '/api/digest') {
    audit_event('rag.index.rebuild.' . ($status < 400 ? 'completed' : 'failed'), $status < 400 ? 'success' : 'failure', $uid, $notebook, [
        'durationMs' => $durationMs,
    ]);
}
$data = sanitize_payload($data, $tokenContext, $tokenConfig);

http_response_code((int)$status);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
echo json_encode($data, JSON_FLAGS);
