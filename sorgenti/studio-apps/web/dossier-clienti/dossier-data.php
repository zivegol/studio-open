<?php
declare(strict_types=1);
define('OC_APP', true);
require_once __DIR__ . '/../../lib/base.php';
header('Content-Type: application/json; charset=utf-8');
$session = \OC::$server->getUserSession();
if (!$session->isLoggedIn()) { http_response_code(401); echo json_encode(['error'=>'Autenticazione Nextcloud richiesta']); exit; }
$user = $session->getUser();
$uid = $user ? $user->getUID() : '';
$allowedUsers = ['studio-example'];
if (!$uid || (!\OC::$server->getGroupManager()->isAdmin($uid) && !in_array(strtolower($uid), $allowedUsers, true))) { http_response_code(403); echo json_encode(['error'=>'Utente non autorizzato al Dossier Cliente']); exit; }
$path = \OC::$SERVERROOT . '/data/admin/files/Studio/DossierClienti/private/dossier-index.json';
if (!is_file($path)) { http_response_code(503); echo json_encode(['error'=>'Indice dossier non ancora disponibile']); exit; }
$data = json_decode((string)file_get_contents($path), true);
if (!is_array($data)) { http_response_code(500); echo json_encode(['error'=>'Indice dossier non valido']); exit; }
$clientId = trim((string)($_GET['clientId'] ?? ''));
if ($clientId !== '') {
  foreach ($data['clients'] ?? [] as $client) if (($client['clientId'] ?? '') === $clientId) { echo json_encode($client, JSON_UNESCAPED_UNICODE); exit; }
  http_response_code(404); echo json_encode(['error'=>'Dossier non trovato']); exit;
}
$list = array_map(static function (array $client): array {
  return [
    'clientId' => $client['clientId'] ?? '',
    'dossierId' => $client['dossierId'] ?? '',
    'displayName' => $client['identity']['displayName'] ?? 'Cliente senza nome',
    'legalForm' => $client['facts']['formaGiuridica']['value'] ?? null,
    'ateco' => $client['facts']['ateco']['value'] ?? null,
    'bilanciCount' => count($client['bilanci'] ?? []),
    'missingCount' => count($client['missingFields'] ?? []),
  ];
}, $data['clients'] ?? []);
echo json_encode([
  'generatedAt' => $data['generatedAt'] ?? null,
  'summary' => $data['summary'] ?? [],
  'clients' => $list,
], JSON_UNESCAPED_UNICODE);
