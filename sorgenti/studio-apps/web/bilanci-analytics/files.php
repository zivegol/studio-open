<?php
declare(strict_types=1);

define('OC_APP', true);
require_once __DIR__ . '/../../lib/base.php';

$userSession = \OC::$server->getUserSession();
if (!$userSession->isLoggedIn()) {
    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Utente Nextcloud non autenticato']);
    exit;
}

$user = $userSession->getUser();
$uid = $user ? $user->getUID() : '';
$groupManager = \OC::$server->getGroupManager();
if (!$uid || !$groupManager->isAdmin($uid)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Utente non autorizzato alla lettura locale dei bilanci']);
    exit;
}

$adminFilesRoot = realpath(\OC::$SERVERROOT . '/data/admin/files');
$allowedPrefix = 'studio-example/archivio studio-example/';

function fail_json(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message]);
    exit;
}

function clean_relative_path(string $path): string {
    $path = str_replace('\\', '/', $path);
    $parts = [];
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') {
            continue;
        }
        if ($part === '..') {
            fail_json(400, 'Percorso non valido');
        }
        $parts[] = $part;
    }
    return implode('/', $parts);
}

function resolve_allowed_path(string $path, string $root, string $allowedPrefix): string {
    $relative = clean_relative_path($path);
    if (strpos($relative, $allowedPrefix) !== 0) {
        fail_json(403, 'Percorso fuori dall\'archivio consentito');
    }
    $absolute = realpath($root . '/' . $relative);
    if ($absolute === false || strpos($absolute, $root) !== 0) {
        fail_json(404, 'File o cartella non trovata');
    }
    return $absolute;
}

if ($adminFilesRoot === false) {
    fail_json(500, 'Archivio admin non trovato');
}

$op = $_GET['op'] ?? '';

if ($op === 'list') {
    $base = clean_relative_path($_GET['base'] ?? 'studio-example/archivio studio-example/bilanci analitici');
    $yearsRaw = (string)($_GET['years'] ?? '');
    $years = array_values(array_filter(array_map('trim', explode(',', $yearsRaw))));
    $result = ['user' => $uid, 'years' => []];

    foreach ($years as $year) {
        if (!preg_match('/^\d{4}$/', $year)) {
            continue;
        }
        $folderRelative = clean_relative_path($base . '/' . $year);
        if (strpos($folderRelative, $allowedPrefix) !== 0) {
            continue;
        }
        $folder = realpath($adminFilesRoot . '/' . $folderRelative);
        if ($folder === false || strpos($folder, $adminFilesRoot) !== 0) {
            $result['years'][$year] = [];
            continue;
        }
        if (!is_dir($folder)) {
            $result['years'][$year] = [];
            continue;
        }
        $files = [];
        foreach (scandir($folder) ?: [] as $name) {
            if ($name === '.' || $name === '..' || strpos($name, '~$') === 0) {
                continue;
            }
            if (!preg_match('/\.(xlsx|xlsm|xls)$/i', $name)) {
                continue;
            }
            if (stripos($name, 'anonimizzat') !== false) {
                continue;
            }
            $relative = $folderRelative . '/' . $name;
            $absolute = $folder . '/' . $name;
            if (is_file($absolute)) {
                $files[] = [
                    'name' => $name,
                    'path' => $relative,
                    'size' => filesize($absolute),
                ];
            }
        }
        $result['years'][$year] = $files;
    }

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($result);
    exit;
}

if ($op === 'file') {
    $path = (string)($_GET['path'] ?? '');
    $absolute = resolve_allowed_path($path, $adminFilesRoot, $allowedPrefix);
    if (!is_file($absolute)) {
        fail_json(404, 'File non trovato');
    }
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Length: ' . filesize($absolute));
    header('X-Content-Type-Options: nosniff');
    readfile($absolute);
    exit;
}

fail_json(400, 'Operazione non valida');
