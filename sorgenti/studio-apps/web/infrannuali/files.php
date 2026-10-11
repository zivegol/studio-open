<?php
declare(strict_types=1);
require_once dirname(__DIR__, 2) . '/lib/base.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
function fail(int $status, string $message): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE); exit;
}
$user = \OC::$server->getUserSession()->getUser();
if ($user === null) fail(401, 'Accedi a Nextcloud per selezionare una cartella.');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') fail(405, 'Metodo non supportato.');
$path = trim((string)($_GET['path'] ?? ''), '/');
foreach (explode('/', $path) as $segment) {
    if ($segment === '..' || $segment === '.' || str_contains($segment, "\0") || str_contains($segment, '\\')) fail(400, 'Percorso non valido.');
}
try {
    $root = \OC::$server->get(\OCP\Files\IRootFolder::class)->getUserFolder($user->getUID());
    $node = $path === '' ? $root : $root->get($path);
    if (!$node->isReadable()) fail(403, 'Non hai permessi di lettura su questa cartella o file.');
    if (($_GET['op'] ?? '') === 'list') {
        if (!$node instanceof \OCP\Files\Folder) fail(400, 'Seleziona una cartella.');
        $entries = [];
        foreach ($node->getDirectoryListing() as $child) {
            $folder = $child instanceof \OCP\Files\Folder;
            if (!$child->isReadable() || (!$folder && !preg_match('/\.(xlsx|xls|xlsm)$/i', $child->getName())) || str_starts_with($child->getName(), '~$')) continue;
            $entries[] = ['name'=>$child->getName(), 'path'=>ltrim($path.'/'.$child->getName(), '/'), 'folder'=>$folder, 'size'=>$folder ? 0 : $child->getSize()];
        }
        usort($entries, fn($a, $b) => ($b['folder'] <=> $a['folder']) ?: strnatcasecmp($a['name'], $b['name']));
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['path'=>$path, 'entries'=>$entries], JSON_UNESCAPED_UNICODE); exit;
    }
    if (($_GET['op'] ?? '') === 'file') {
        if (!$node instanceof \OCP\Files\File || !preg_match('/\.(xlsx|xls|xlsm)$/i', $node->getName())) fail(400, 'Seleziona un file Excel.');
        if ($node->getSize() > 30*1024*1024) fail(413, 'File oltre il limite di 30 MB.');
        header('Content-Type: application/octet-stream'); echo $node->getContent(); exit;
    }
    fail(400, 'Operazione non valida.');
} catch (\OCP\Files\NotFoundException $e) { fail(404, 'Cartella o file non trovato. Puoi navigare dalla tua cartella principale.');
} catch (\OCP\Files\NotPermittedException $e) { fail(403, 'Permesso negato.');
} catch (Throwable $e) { fail(500, 'Lettura archivio non riuscita.'); }
