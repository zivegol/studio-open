<?php
declare(strict_types=1);

$studioServerRoot = dirname(__DIR__, 2);
if (!is_file($studioServerRoot . '/lib/base.php')) $studioServerRoot = __DIR__ . '/html';
require_once $studioServerRoot . '/lib/base.php';

header('Cache-Control: no-store');

function studio_fail(int $status, string $message): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function studio_path(): string {
    $path = trim((string)($_GET['path'] ?? ''), '/');
    if ($path === '') return '';
    $segments = explode('/', $path);
    foreach ($segments as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..' || str_contains($segment, "\0")) {
            studio_fail(400, 'Percorso non valido.');
        }
    }
    return implode('/', $segments);
}

function studio_ensure_folder(\OCP\Files\Folder $root, string $path): \OCP\Files\Folder {
    $current = $root;
    foreach (array_filter(explode('/', $path), 'strlen') as $segment) {
        try {
            $node = $current->get($segment);
            if (!$node instanceof \OCP\Files\Folder) studio_fail(409, 'Il percorso contiene un file.');
            $current = $node;
        } catch (\OCP\Files\NotFoundException) {
            $current = $current->newFolder($segment);
        }
    }
    return $current;
}

$publicOp = (string)($_GET['op'] ?? '');
if ($publicOp === 'partitari-share-get' && strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'GET') {
    header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store'); header('X-Robots-Tag: noindex, nofollow');
    $token = strtolower(trim((string)($_GET['token'] ?? '')));
    if (!preg_match('/^[a-f0-9]{48}$/', $token)) studio_fail(404, 'Collegamento non valido.');
    try {
        $publicRoot = \OC::$server->get(\OCP\Files\IRootFolder::class)->getUserFolder('admin');
        $shareNode = $publicRoot->get('Studio/Partitari/shares/'.$token.'.json');
        if (!$shareNode instanceof \OCP\Files\File) studio_fail(404, 'Dashboard non disponibile.');
        $shareData = json_decode($shareNode->getContent(), true);
        if (!is_array($shareData) || empty($shareData['client'])) studio_fail(404, 'Dashboard non disponibile.');
        if (strtotime((string)($shareData['expiresAt'] ?? '')) < time()) studio_fail(410, 'Il collegamento è scaduto.');
        echo json_encode(['client'=>$shareData['client'],'createdAt'=>$shareData['createdAt'],'expiresAt'=>$shareData['expiresAt']], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit;
    } catch (\OCP\Files\NotFoundException) { studio_fail(404, 'Dashboard non disponibile.'); }
}

$user = \OC::$server->getUserSession()->getUser();
if ($user === null) studio_fail(401, 'Sessione Nextcloud assente o scaduta.');

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$op = (string)($_GET['op'] ?? 'user');
if ($method !== 'GET' && (string)($_SERVER['HTTP_X_STUDIO_REQUEST'] ?? '') !== 'true') {
    studio_fail(403, 'Richiesta Studio non valida.');
}

$uid = $user->getUID();
$root = \OC::$server->getUserFolder($uid);
$allowedStudioUsers = ['studio-example', 'info@studio.example'];
$isStudioUser = \OC::$server->getGroupManager()->isAdmin($uid) || in_array(strtolower($uid), $allowedStudioUsers, true);

try {
    if ($op === 'user' && $method === 'GET') {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => true, 'id' => $uid, 'displayName' => $user->getDisplayName()], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($op === 'dossier-document' && $method === 'GET') {
        $allowedDossierUsers = ['studio-example', 'info@studio.example'];
        $isAdmin = \OC::$server->getGroupManager()->isAdmin($uid);
        if (!$isAdmin && !in_array(strtolower($uid), $allowedDossierUsers, true)) studio_fail(403, 'Utente non autorizzato al Dossier Cliente.');
        $clientId = trim((string)($_GET['clientId'] ?? ''));
        $documentSourceId = trim((string)($_GET['documentSourceId'] ?? ''));
        if ($clientId === '' || $documentSourceId === '') studio_fail(400, 'Documento o cliente mancante.');
        $adminRoot = \OC::$server->get(\OCP\Files\IRootFolder::class)->getUserFolder('admin');
        $indexNode = $adminRoot->get('Studio/DossierClienti/private/dossier-index.json');
        if (!$indexNode instanceof \OCP\Files\File) studio_fail(404, 'Indice Dossier non disponibile.');
        $data = json_decode($indexNode->getContent(), true);
        $sourcePath = null;
        foreach (($data['clients'] ?? []) as $client) {
            if (($client['clientId'] ?? '') !== $clientId) continue;
            foreach (($client['documentCatalog'] ?? []) as $document) {
                if (($document['documentSourceId'] ?? '') === $documentSourceId) { $sourcePath = (string)($document['sourcePath'] ?? ''); break 2; }
            }
        }
        if ($sourcePath === '' || $sourcePath === null || str_contains($sourcePath, '..')) studio_fail(404, 'Documento non associato al cliente.');
        $node = $adminRoot->get('studio-example/archivio studio-example/' . ltrim($sourcePath, '/'));
        if (!$node instanceof \OCP\Files\File) studio_fail(404, 'Documento non disponibile.');
        $safeName = str_replace(['"', "\r", "\n"], '', $node->getName());
        $extension = strtolower(pathinfo($safeName, PATHINFO_EXTENSION));
        $preview = (string)($_GET['preview'] ?? '') === '1';
        $mime = $node->getMimeType() ?: 'application/octet-stream';
        if ($preview && in_array($extension, ['xbrl', 'xml'], true)) $mime = 'application/xml; charset=utf-8';
        header('Content-Type: ' . $mime);
        header('Content-Disposition: inline; filename="' . $safeName . '"');
        header('X-Studio-Filename: ' . rawurlencode($safeName));
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . $node->getSize());
        echo $node->getContent();
        exit;
    }

    if ($op === 'partitari-share-create' && $method === 'POST') {
        if (!$isStudioUser) studio_fail(403, 'Utente non autorizzato alla condivisione Partitari.');
        $input = json_decode((string)file_get_contents('php://input'), true);
        $client = is_array($input['client'] ?? null) ? $input['client'] : null;
        if ($client === null || trim((string)($client['name'] ?? '')) === '') studio_fail(400, 'Cliente non valido.');
        $excluded = array_fill_keys(array_map('strval', is_array($client['esclusi'] ?? null) ? $client['esclusi'] : []), true);
        $accounts = [];
        foreach (is_array($client['conti'] ?? null) ? $client['conti'] : [] as $key => $account) {
            if (!is_array($account)) continue;
            $code = (string)($account['codice'] ?? $key);
            if (isset($excluded[$code])) continue;
            $accounts[$key] = $account;
        }
        $movements = array_values(array_filter(is_array($client['movimenti'] ?? null) ? $client['movimenti'] : [], static function ($movement) use ($excluded): bool {
            return is_array($movement) && !isset($excluded[(string)($movement['codice'] ?? '')]);
        }));
        $safeClient = ['name'=>(string)$client['name'],'period'=>(string)($client['period']??''),'conti'=>$accounts,'movimenti'=>$movements,'esclusi'=>[],'scenari'=>[]];
        $token = bin2hex(random_bytes(24));
        $createdAt = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $payload = ['schemaVersion'=>1,'createdAt'=>$createdAt->format(DATE_ATOM),'expiresAt'=>$createdAt->modify('+30 days')->format(DATE_ATOM),'createdBy'=>$uid,'client'=>$safeClient];
        $adminRoot = \OC::$server->get(\OCP\Files\IRootFolder::class)->getUserFolder('admin');
        $folder = studio_ensure_folder($adminRoot, 'Studio/Partitari/shares');
        $folder->newFile($token.'.json', json_encode($payload, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok'=>true,'url'=>'/studio-apps/partitari/partitari_dashboard.html?share='.$token,'expiresAt'=>$payload['expiresAt']], JSON_UNESCAPED_SLASHES);
        exit;
    }

    if ($op === 'partitari-save' && $method === 'POST') {
        if (!$isStudioUser) studio_fail(403, 'Utente non autorizzato ai Partitari.');
        $input = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($input) || !is_array($input['clients'] ?? null)) studio_fail(400, 'Archivio Partitari non valido.');
        $adminRoot = \OC::$server->get(\OCP\Files\IRootFolder::class)->getUserFolder('admin');
        $folder = studio_ensure_folder($adminRoot, 'Studio/Partitari/private');
        $currentRevision = 0; $file = null;
        try {
            $candidate = $folder->get('partitari-db.json');
            if ($candidate instanceof \OCP\Files\File) { $file = $candidate; $current = json_decode($file->getContent(), true); $currentRevision = (int)($current['revision'] ?? 0); }
        } catch (\OCP\Files\NotFoundException) {}
        $baseRevision = (int)($input['baseRevision'] ?? 0);
        if ($baseRevision !== $currentRevision) {
            http_response_code(409); header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['ok'=>false,'error'=>'Archivio modificato da un altro utente','revision'=>$currentRevision]); exit;
        }
        $payload = ['schemaVersion'=>2,'revision'=>$currentRevision+1,'updatedAt'=>(new DateTimeImmutable('now',new DateTimeZone('UTC')))->format(DATE_ATOM),'updatedBy'=>$uid,'clients'=>$input['clients']];
        $content = json_encode($payload, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
        if ($file instanceof \OCP\Files\File) $file->putContent($content); else $folder->newFile('partitari-db.json', $content);
        header('Content-Type: application/json; charset=utf-8'); echo json_encode(['ok'=>true,'revision'=>$payload['revision'],'updatedAt'=>$payload['updatedAt']]); exit;
    }

    $path = studio_path();
    if ($path === '') studio_fail(400, 'Percorso mancante.');
    if ($path === 'Studio/Partitari/private/partitari-db.json') {
        if (!$isStudioUser) studio_fail(403, 'Utente non autorizzato ai Partitari.');
        $root = \OC::$server->get(\OCP\Files\IRootFolder::class)->getUserFolder('admin');
    }

    if ($op === 'ensure' && $method === 'POST') {
        studio_ensure_folder($root, $path);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($op === 'get' && $method === 'GET') {
        if ($path === 'Studio/DossierClienti/private/dossier-index.json') {
            $allowedDossierUsers = ['studio-example', 'info@studio.example'];
            $isAdmin = \OC::$server->getGroupManager()->isAdmin($uid);
            if (!$isAdmin && !in_array(strtolower($uid), $allowedDossierUsers, true)) {
                studio_fail(403, 'Utente non autorizzato al Dossier Cliente.');
            }
            $root = \OC::$server->get(\OCP\Files\IRootFolder::class)->getUserFolder('admin');
        }
        try {
            $node = $root->get($path);
        } catch (\OCP\Files\NotFoundException) {
            studio_fail(404, 'File non trovato.');
        }
        if (!$node instanceof \OCP\Files\File) studio_fail(409, 'Il percorso non indica un file.');
        header('Content-Type: application/json; charset=utf-8');
        header('ETag: "' . $node->getEtag() . '"');
        echo $node->getContent();
        exit;
    }

    if ($op === 'put' && $method === 'POST') {
        $folderPath = dirname($path);
        $fileName = basename($path);
        $folder = $folderPath === '.' ? $root : studio_ensure_folder($root, $folderPath);
        $content = file_get_contents('php://input');
        if ($content === false) studio_fail(400, 'Contenuto non leggibile.');
        try {
            $file = $folder->get($fileName);
            if (!$file instanceof \OCP\Files\File) studio_fail(409, 'Il percorso esiste ma non è un file.');
            $file->putContent($content);
        } catch (\OCP\Files\NotFoundException) {
            $file = $folder->newFile($fileName, $content);
        }
        header('Content-Type: application/json; charset=utf-8');
        header('ETag: "' . $file->getEtag() . '"');
        echo json_encode(['ok' => true, 'etag' => $file->getEtag()]);
        exit;
    }

    studio_fail(405, 'Operazione non supportata.');
} catch (\OCP\Files\NotPermittedException) {
    studio_fail(403, 'Permesso negato.');
} catch (\OCP\Files\StorageNotAvailableException) {
    studio_fail(503, 'Archivio Nextcloud non disponibile.');
} catch (Throwable $error) {
    studio_fail(500, 'Errore archivio Studio: ' . $error->getMessage());
}
