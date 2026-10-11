<?php
declare(strict_types=1);
define('OC_APP', true);
require_once __DIR__ . '/../../lib/base.php';
header('Content-Type: application/json; charset=utf-8');

$authorization = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
if (!str_starts_with($authorization, 'Basic ')) {
    http_response_code(401); echo json_encode(['error' => 'Autenticazione richiesta']); exit;
}
$decoded = base64_decode(substr($authorization, 6), true);
if ($decoded === false || !str_contains($decoded, ':')) {
    http_response_code(401); echo json_encode(['error' => 'Autenticazione non valida']); exit;
}
[$uid, $password] = explode(':', $decoded, 2);
$authenticatedUid = \OC_User::checkPassword($uid, $password);
if (!$authenticatedUid) {
    http_response_code(401); echo json_encode(['error' => 'Credenziali non valide']); exit;
}
$folder = trim((string)($_GET['folder'] ?? ''));
if ($folder === '' || str_contains($folder, '..')) {
    http_response_code(400); echo json_encode(['error' => 'Cartella non valida']); exit;
}
$script = __DIR__ . '/revision_folder_parser.py';
$command = 'python3 ' . escapeshellarg($script) . ' ' . escapeshellarg($folder) . ' 2>&1';
$output = shell_exec($command);
if (!is_string($output) || trim($output) === '') {
    http_response_code(500); echo json_encode(['error' => 'Parser documentale non disponibile']); exit;
}
$payload = json_decode(trim($output), true);
if (!is_array($payload)) {
    http_response_code(500); echo json_encode(['error' => 'Risposta parser non valida']); exit;
}
if (isset($payload['error'])) http_response_code(422);
echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
