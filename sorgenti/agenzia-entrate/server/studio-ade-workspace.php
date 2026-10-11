<?php
declare(strict_types=1);
// Included only by the authenticated Nextcloud gateway, after access checks.
if (!isset($root, $uid, $method, $op, $base)) { http_response_code(403); exit; }
if ($op === 'delegations') {
    $path = $base . '/RegistroDeleghe';
    if ($method === 'GET') {
        $items = [];
        try {
            foreach ($root->get($path)->getDirectoryListing() as $file) {
                if ($file instanceof \OCP\Files\File && str_ends_with($file->getName(), '.json')) {
                    $record = json_decode($file->getContent(), true);
                    if (is_array($record)) $items[] = $record;
                }
            }
        } catch (\OCP\Files\NotFoundException) {}
        reply(200, ['delegations' => $items]);
    }
    if ($method !== 'POST') reply(405, ['error'=>'Metodo non consentito.']);
    if (!\OC::$server->getRequest()->passesCSRFCheck()) reply(403, ['error'=>'Sessione scaduta. Ricarica l’app.']);
    $d = json_decode(file_get_contents('php://input', false, null, 0, 8193), true);
    if (!is_array($d)) reply(400, ['error'=>'Richiesta non valida.']);
    $client = taxcode($d['client'] ?? '');
    $service = (string)($d['service'] ?? '');
    if (!in_array($service, ['cassetto','fatture'], true)) reply(400, ['error'=>'Servizio non valido.']);
    $expires = (string)($d['expires'] ?? '');
    $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $expires);
    if (!$date || $date->format('Y-m-d') !== $expires) reply(400, ['error'=>'Data non valida.']);
    $reference = trim((string)($d['reference'] ?? ''));
    if ($reference === '' || strlen($reference)>300) reply(400, ['error'=>'Indica un riferimento alla delega, massimo 300 caratteri.']);
    $record = ['client'=>$client,'service'=>$service,'expires'=>$expires,'reference'=>$reference,'revoked'=>($d['revoked']??false)===true,'updatedAt'=>gmdate('c'),'updatedBy'=>$uid,'source'=>'registro-studio'];
    $dir = folder($root, $path); $name = hash('sha256', $client . ':' . $service) . '.json';
    $json = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    if ($dir->nodeExists($name)) $dir->get($name)->putContent($json); else $dir->newFile($name, $json);
    ade_audit_log($uid, $client, 'delega-registro-studio', ['service'=>$service,'revoked'=>$record['revoked']], 'ok');
    reply(200, ['saved'=>true]);
}
