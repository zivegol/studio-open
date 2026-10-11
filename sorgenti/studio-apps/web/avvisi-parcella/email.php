<?php
declare(strict_types=1);

require_once __DIR__.'/domain.php';

function formatCentsEur(int $cents): string {
    return number_format($cents / 100, 2, ',', '.') . ' €';
}

function buildNoticeEmailData(array $notice, array $studio): array {
    $client = $notice['client'] ?? [];
    $clientName = !empty($client['name']) ? $client['name'] : 'Gentile Cliente';
    $toEmail = $client['email'] ?? '';
    $number = $notice['number'] ?? '';
    $date = date('d/m/Y', strtotime($notice['date'] ?? date('Y-m-d')));
    $totals = $notice['totals'] ?? [];
    $netFormatted = formatCentsEur((int)($totals['net'] ?? 0));
    $baseFormatted = formatCentsEur((int)($totals['base'] ?? 0));
    $fundFormatted = formatCentsEur((int)($totals['fund'] ?? 0));
    $vatFormatted = formatCentsEur((int)($totals['vat'] ?? 0));
    $withholdingFormatted = formatCentsEur((int)($totals['withholding'] ?? 0));
    $stampFormatted = formatCentsEur((int)($totals['stamp'] ?? 0));
    
    $periodLabel = !empty($notice['period']['label']) ? $notice['period']['label'] : '';
    $serviceDesc = !empty($notice['serviceDescription']) ? $notice['serviceDescription'] : '';
    $iban = !empty($studio['iban']) ? $studio['iban'] : (string)(getenv('STUDIO_IBAN') ?: '');
    if ($iban === '') { throw new RuntimeException('Configurare IBAN dello studio prima di generare una email.'); }
    $beneficiary = 'Professionista da configurare';

    $subject = "Studio Dott. Professionista da configurare - Avviso di parcella n. " . $number;

    // Plain text body
    $linesText = "";
    foreach (($notice['lines'] ?? []) as $l) {
        $q = $l['quantity'] ?? 1;
        $unitPrice = formatCentsEur((int)round(((float)$l['amount']) * 100));
        $totLine = formatCentsEur(lineTotal($l));
        $linesText .= sprintf("  • %s (Quantità: %s, Prezzo unit.: %s) -> Totale: %s\n", $l['description'], $q, $unitPrice, $totLine);
    }

    $bodyText = "Gentile {$clientName},\n\n";
    $bodyText .= "Le trasmettiamo l'avviso di parcella n. {$number} del {$date}.\n\n";
    if ($periodLabel !== '') {
        $bodyText .= "Periodo di riferimento: {$periodLabel}\n";
    }
    if ($serviceDesc !== '') {
        $bodyText .= "Oggetto prestazione: {$serviceDesc}\n";
    }
    $bodyText .= "Scadenza: A VISTA (alla ricezione del presente avviso)\n";
    $bodyText .= "Importo netto a pagare: {$netFormatted}\n\n";
    
    $bodyText .= "======================================================================\n";
    $bodyText .= "AVVISO IMPORTANTE SULLE COORDINATE BANCARIE DI ACCREDITO\n";
    $bodyText .= "======================================================================\n";
    $bodyText .= "Si segnala che l'Iban di accredito dello Studio è stato modificato ed il bonifico deve essere effettuato in favore di Professionista da configurare, Iban {$iban}.\n\n";
    $bodyText .= "Riepilogo coordinate per il bonifico:\n";
    $bodyText .= "  • Intestatario conto corrente: {$beneficiary}\n";
    $bodyText .= "  • IBAN: {$iban}\n";
    $bodyText .= "  • Causale: Saldo avviso di parcella n. {$number}\n";
    $bodyText .= "  • Scadenza: A vista\n";
    $bodyText .= "======================================================================\n\n";

    $bodyText .= "DETTAGLIO PRESTAZIONI ED IMPORTI:\n";
    $bodyText .= $linesText . "\n";
    $bodyText .= "Riepilogo contabile:\n";
    $bodyText .= "  - Compensi imponibili: {$baseFormatted}\n";
    if (!empty($totals['fund'])) $bodyText .= "  - Cassa previdenza (4%): {$fundFormatted}\n";
    if (!empty($totals['vat'])) $bodyText .= "  - IVA (22%): {$vatFormatted}\n";
    if (!empty($totals['stamp'])) $bodyText .= "  - Bollo: {$stampFormatted}\n";
    if (!empty($totals['withholding'])) $bodyText .= "  - Ritenuta d'acconto (20%): -{$withholdingFormatted}\n";
    $bodyText .= "  --------------------------------------------------\n";
    $bodyText .= "  TOTALE NETTO A PAGARE: {$netFormatted}\n\n";

    if (!empty($notice['note'])) {
        $bodyText .= "Note: " . $notice['note'] . "\n\n";
    }

    $bodyText .= "Restiamo a completa disposizione per qualunque ulteriore chiarimento.\n\n";
    $bodyText .= "Cordiali saluti,\n\n";
    $bodyText .= "Studio Dott. Professionista da configurare\n";
    $bodyText .= "Dottore Commercialista e Revisore Legale\n";
    $bodyText .= "Indirizzo da configurare\n";
    $bodyText .= "PEC: professionista@studio.example\n";

    // HTML body
    $linesHtml = "";
    foreach (($notice['lines'] ?? []) as $l) {
        $q = htmlspecialchars((string)($l['quantity'] ?? 1), ENT_QUOTES, 'UTF-8');
        $desc = htmlspecialchars($l['description'] ?? '', ENT_QUOTES, 'UTF-8');
        $unitPrice = formatCentsEur((int)round(((float)$l['amount']) * 100));
        $totLine = formatCentsEur(lineTotal($l));
        $linesHtml .= "<tr><td style=\"padding:8px;border-bottom:1px solid #e2e8f0;\">{$desc}</td><td style=\"padding:8px;text-align:center;border-bottom:1px solid #e2e8f0;\">{$q}</td><td style=\"padding:8px;text-align:right;border-bottom:1px solid #e2e8f0;\">{$unitPrice}</td><td style=\"padding:8px;text-align:right;font-weight:600;border-bottom:1px solid #e2e8f0;\">{$totLine}</td></tr>";
    }

    $safeClient = htmlspecialchars($clientName, ENT_QUOTES, 'UTF-8');
    $safeNumber = htmlspecialchars($number, ENT_QUOTES, 'UTF-8');
    $safePeriod = htmlspecialchars($periodLabel, ENT_QUOTES, 'UTF-8');
    $safeService = htmlspecialchars($serviceDesc, ENT_QUOTES, 'UTF-8');
    $safeIban = htmlspecialchars($iban, ENT_QUOTES, 'UTF-8');

    $periodHtml = $safePeriod !== '' ? "<p style=\"margin:4px 0;\"><strong>Periodo di riferimento:</strong> {$safePeriod}</p>" : '';
    $serviceHtml = $safeService !== '' ? "<p style=\"margin:4px 0;\"><strong>Oggetto:</strong> {$safeService}</p>" : '';
    $fundRow = !empty($totals['fund']) ? "<div style=\"display:flex;justify-content:space-between;margin-bottom:4px;\"><span>Cassa previdenza (4%):</span><span>{$fundFormatted}</span></div>" : '';
    $vatRow = !empty($totals['vat']) ? "<div style=\"display:flex;justify-content:space-between;margin-bottom:4px;\"><span>IVA (22%):</span><span>{$vatFormatted}</span></div>" : '';
    $stampRow = !empty($totals['stamp']) ? "<div style=\"display:flex;justify-content:space-between;margin-bottom:4px;\"><span>Bollo:</span><span>{$stampFormatted}</span></div>" : '';
    $withholdingRow = !empty($totals['withholding']) ? "<div style=\"display:flex;justify-content:space-between;margin-bottom:4px;color:#b91c1c;\"><span>Ritenuta d'acconto (20%):</span><span>-{$withholdingFormatted}</span></div>" : '';

    $bodyHtml = <<<HTML
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; margin: 0; padding: 20px; background-color: #f1f5f9; }
.card { max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #cbd5e1; padding: 30px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
.header { border-bottom: 2px solid #0284c7; padding-bottom: 15px; margin-bottom: 20px; }
.header h2 { margin: 0; color: #0f172a; font-size: 20px; }
.header p { margin: 4px 0 0 0; color: #64748b; font-size: 13px; }
.alert-box { background: #fffbeb; border: 2px solid #f59e0b; border-left: 6px solid #d97706; padding: 16px; border-radius: 6px; margin: 20px 0; }
.alert-title { color: #b45309; font-weight: bold; font-size: 15px; margin-bottom: 6px; }
.alert-text { color: #78350f; font-size: 14px; line-height: 1.6; }
.iban-badge { display: inline-block; font-family: monospace; font-size: 16px; font-weight: bold; color: #1e3a8a; background: #e0f2fe; padding: 4px 8px; border-radius: 4px; margin: 4px 0; }
.details-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin: 20px 0; }
.table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; }
.table th { background: #f1f5f9; padding: 8px; text-align: left; font-size: 13px; color: #475569; border-bottom: 2px solid #cbd5e1; }
.totals { margin-top: 15px; padding-top: 10px; border-top: 2px solid #cbd5e1; font-size: 14px; }
.net-pay { font-size: 18px; font-weight: bold; color: #0284c7; padding-top: 8px; border-top: 1px dashed #cbd5e1; margin-top: 8px; display: flex; justify-content: space-between; }
.footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h2>STUDIO DOTT. Professionista da configurare</h2>
    <p>Dottore Commercialista e Revisore Legale · Verona</p>
  </div>

  <p>Gentile <strong>{$safeClient}</strong>,</p>
  <p>Le trasmettiamo l'avviso di parcella <strong>n. {$safeNumber}</strong> del <strong>{$date}</strong>.</p>
  {$periodHtml}
  {$serviceHtml}

  <div class="alert-box">
    <div class="alert-title">⚠️ AVVISO IMPORTANTE: MODIFICA COORDINATE BANCARIE</div>
    <div class="alert-text">
      Si segnala che l'<b>Iban di accredito</b> dello Studio è stato modificato ed il bonifico deve essere effettuato in favore di <b>Professionista da configurare</b>, Iban <b>{$safeIban}</b>.<br><br>
      • <strong>Intestatario conto corrente:</strong> <span style="font-size:15px;font-weight:bold;color:#0f172a;">Professionista da configurare</span><br>
      • <strong>Nuovo IBAN:</strong> <span class="iban-badge">{$safeIban}</span><br>
      • <strong>Causale:</strong> Saldo avviso di parcella n. {$safeNumber}<br>
      • <strong>Scadenza del pagamento:</strong> <span style="font-weight:bold;color:#b45309;">A vista</span>
    </div>
  </div>

  <div class="details-box">
    <h3 style="margin-top:0;font-size:15px;color:#0f172a;">Dettaglio prestazioni ed adempimenti</h3>
    <table class="table">
      <thead>
        <tr><th>Descrizione</th><th style="text-align:center;">Q.tà</th><th style="text-align:right;">Prezzo unit.</th><th style="text-align:right;">Totale</th></tr>
      </thead>
      <tbody>
        {$linesHtml}
      </tbody>
    </table>
    <div class="totals">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Compensi imponibili:</span><span>{$baseFormatted}</span></div>
      {$fundRow}
      {$vatRow}
      {$stampRow}
      {$withholdingRow}
      <div class="net-pay"><span>TOTALE NETTO A PAGARE:</span><span>{$netFormatted}</span></div>
    </div>
  </div>

  <p>Restiamo a disposizione per qualsiasi necessità o chiarimento.</p>
  <p>Cordiali saluti,<br>
  <strong>Studio Dott. Professionista da configurare</strong></p>

  <div class="footer">
    Studio Associato studio-example · Dott. Professionista da configurare<br>
    Indirizzo da configurare · P. IVA 00000000000 · PEC: professionista@studio.example<br>
    <em>Documento inviato tramite la piattaforma di gestione contabile dello studio.</em>
  </div>
</div>
</body>
</html>
HTML;

    return [
        'toEmail' => $toEmail,
        'clientName' => $clientName,
        'subject' => $subject,
        'text' => $bodyText,
        'html' => $bodyHtml,
        'netFormatted' => $netFormatted,
        'iban' => $iban,
        'beneficiary' => $beneficiary
    ];
}

function sendNoticeEmailViaMailer(array $notice, string $toEmail, ?string $subject = null, ?string $bodyText = null, ?string $bodyHtml = null): void {
    demand(filter_var($toEmail, FILTER_VALIDATE_EMAIL) !== false, 'Indirizzo email destinatario non valido: ' . $toEmail);
    $built = buildNoticeEmailData($notice, $notice['studio'] ?? []);
    
    $mailer = \OC::$server->getMailer();
    $message = $mailer->createMessage();
    $message->setSubject($subject ?: $built['subject']);
    
    $config = \OC::$server->getConfig();
    $fromUser = $config->getSystemValue('mail_from_address', 'info');
    $fromDomain = $config->getSystemValue('mail_domain', 'studio.example');
    $fromAddress = $fromUser . '@' . $fromDomain;
    $fromName = !empty($notice['studio']['name']) ? $notice['studio']['name'] : 'Studio Dott. Professionista da configurare';
    
    $message->setFrom([$fromAddress => $fromName]);
    $message->setTo([$toEmail => $notice['client']['name'] ?? 'Cliente']);
    $message->setPlainBody($bodyText ?: $built['text']);
    if (!empty($bodyHtml ?: $built['html'])) {
        $message->setHtmlBody($bodyHtml ?: $built['html']);
    }
    
    $mailer->send($message);
}
