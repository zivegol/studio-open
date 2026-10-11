<?php
declare(strict_types=1);
define('OC_APP', true);
require_once __DIR__ . '/../../lib/base.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
$token = strtolower(trim((string)($_GET['token'] ?? '')));
if (!preg_match('/^[a-f0-9]{48}$/', $token)) { http_response_code(404); echo json_encode(['error'=>'Collegamento non valido']); exit; }
try {
    $root = \OC::$server->get(\OCP\Files\IRootFolder::class)->getUserFolder('admin');
    $node = $root->get('Studio/Partitari/shares/' . $token . '.json');
    if (!$node instanceof \OCP\Files\File) throw new RuntimeException('not found');
    $data = json_decode($node->getContent(), true);
    if (!is_array($data) || empty($data['client'])) throw new RuntimeException('invalid');
    if (strtotime((string)($data['expiresAt'] ?? '')) < time()) { http_response_code(410); echo json_encode(['error'=>'Il collegamento è scaduto']); exit; }
    echo json_encode(['client'=>$data['client'],'createdAt'=>$data['createdAt'],'expiresAt'=>$data['expiresAt']], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) { http_response_code(404); echo json_encode(['error'=>'Dashboard non disponibile']); }
