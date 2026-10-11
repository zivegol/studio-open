<?php
declare(strict_types=1);

// Explicit links take precedence. Fiscal fallback must identify one client only.
function dossierProfile(array $state, array $dossier): array {
    $id = (string)$dossier['clientId'];
    $normalize = static fn($v) => strtoupper(trim((string)$v));
    $all = array_values($state['clients'] ?? []);
    $matches = array_values(array_filter($all, static fn($c) => ($c['dossierId'] ?? '') === $id));
    if (!$matches) {
        $cf = $normalize($dossier['identity']['taxCode'] ?? '');
        $vat = $normalize($dossier['identity']['vatNumber'] ?? '');
        $matches = array_values(array_filter($all, static function($c) use ($cf, $vat, $normalize) {
            if (!empty($c['dossierId'])) return false;
            $ccf = $normalize($c['cf'] ?? ''); $cvat = $normalize($c['vat'] ?? '');
            if ($cf !== '' && $ccf !== '' && $cf !== $ccf) return false;
            if ($vat !== '' && $cvat !== '' && $vat !== $cvat) return false;
            return ($cf !== '' && $cf === $ccf) || ($vat !== '' && $vat === $cvat);
        }));
    }
    if (count($matches) !== 1) return ['status' => $matches ? 'ambiguous' : 'missing'];
    $client = $matches[0];
    $notices = array_values(array_filter($state['notices'] ?? [], static fn($n) => $n['clientId'] === $client['id']));
    $noticeIds = array_column($notices, 'id');
    $invoices = array_values(array_filter($state['invoices'] ?? [], static fn($f) => in_array($f['noticeId'], $noticeIds, true)));
    return ['status'=>'found', 'client'=>$client, 'notices'=>$notices, 'invoices'=>$invoices];
}
