<?php
declare(strict_types=1);
define('OC_APP', true);
require_once __DIR__ . '/../../lib/base.php';
header('Content-Type: application/json; charset=utf-8');
$session = \OC::$server->getUserSession();
if (!$session->isLoggedIn()) { http_response_code(401); echo json_encode(['error'=>'Autenticazione Nextcloud richiesta']); exit; }
$user = $session->getUser();
$uid = $user ? $user->getUID() : '';
if (!$uid || !\OC::$server->getGroupManager()->isAdmin($uid)) { http_response_code(403); echo json_encode(['error'=>'Dossier Cliente attualmente riservato agli amministratori']); exit; }
$path = \OC::$SERVERROOT . '/data/admin/files/Studio/DossierClienti/private/dossier-index.json';
if (!is_file($path)) { http_response_code(503); echo json_encode(['error'=>'Indice dossier non ancora disponibile']); exit; }
$data = json_decode((string)file_get_contents($path), true);
if (!is_array($data)) { http_response_code(500); echo json_encode(['error'=>'Indice dossier non valido']); exit; }
$clientId = trim((string)($_GET['clientId'] ?? ''));
if ($clientId !== '') {
  foreach ($data['clients'] ?? [] as $client) if (($client['clientId'] ?? '') === $clientId) { echo json_encode($client, JSON_UNESCAPED_UNICODE); exit; }
  http_response_code(404); echo json_encode(['error'=>'Dossier non trovato']); exit;
}
$list = array_map(function($client) { return [
  'clientId'=>$client['clientId'], 'dossierId'=>$client['dossierId'], 'displayName'=>$client['identity']['displayName'],
  'legalForm'=>$client['facts']['formaGiuridica']['value'], 'ateco'=>$client['facts']['ateco']['value'],
  'bilanciCount'=>count($client['bilanci'] ?? []), 'missingCount'=>count($client['missingFields'] ?? []),
]; }, $data['clients'] ?? []);
echo json_encode(['generatedAt'=>$data['generatedAt'], 'summary'=>$data['summary'], 'clients'=>$list], JSON_UNESCAPED_UNICODE);
