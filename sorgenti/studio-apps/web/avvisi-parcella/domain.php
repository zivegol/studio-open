<?php
declare(strict_types=1);
require_once __DIR__.'/quarters.php';

function demand(bool $ok, string $message): void { if (!$ok) throw new DomainException($message); }
function day(string $v): string { $d=DateTimeImmutable::createFromFormat('!Y-m-d',$v); demand($d && $d->format('Y-m-d')===$v,'Data non valida'); return $v; }
function money(mixed $v): int { demand(is_numeric($v) && is_finite((float)$v) && (float)$v>=0 && (float)$v<=100000000,'Importo non valido'); return (int)round((float)$v*100,0,PHP_ROUND_HALF_UP); }
function pct(mixed $v): int { $n=money($v); demand($n<=10000,'Percentuale non valida'); return $n; }
function portion(int $base,int $rate): int { $prod=$base*$rate; return $prod>=0?intdiv($prod+5000,10000):intdiv($prod-5000,10000); }
function ident(): string { return bin2hex(random_bytes(12)); }
function textval(mixed $v,int $max=1000): string { $s=trim((string)$v); demand(mb_strlen($s)<=$max && !preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u',$s),'Testo non valido o troppo lungo'); return $s; }
function party(array $p): array { $o=[]; foreach(['name','vat','cf','address','zip','city','province','sdi','pec','email','iban'] as $k) $o[$k]=textval($p[$k]??'', $k==='name'?80:100); foreach(['vat','cf','province','sdi','iban'] as $k)$o[$k]=strtoupper($o[$k]); if(!empty($o['email'])){$o['email']=strtolower($o['email']);demand(filter_var($o['email'],FILTER_VALIDATE_EMAIL)!==false,'Indirizzo email non valido');} demand($o['name']!=='','Denominazione obbligatoria'); return $o; }
function lines(array $ls): array { demand(count($ls)>0 && count($ls)<=100,'Inserire da 1 a 100 righe'); return array_map(function($l){$d=textval($l['description']??''); demand($d!=='','Descrizione obbligatoria'); $a=money($l['amount']??''); demand($a>0,'Gli importi devono essere positivi'); $q=money($l['quantity']??1); demand($q>0 && $q<=1000000,'Quantità non valida (da 0,01 a 10.000)'); $basis=(string)($l['basis']??'item'); demand(in_array($basis,['item','quarter'],true),'Unità di compenso non valida'); return ['description'=>$d,'amount'=>$a/100,'quantity'=>$q/100,'basis'=>$basis];},$ls); }
function rates(array $r): array { $o=[]; foreach(['vatRate','fundRate','withholdingRate'] as $k)$o[$k]=pct($r[$k]??0)/100; $o['stamp']=money($r['stamp']??0)/100; $o['nature']=textval($r['nature']??'N2.2',4); demand(in_array($o['nature'],['N1','N2.1','N2.2','N3.1','N3.2','N3.3','N3.4','N3.5','N3.6','N4','N5','N6.1','N6.2','N6.3','N6.4','N6.5','N6.6','N6.7','N6.8','N6.9','N7'],true),'Natura IVA non valida'); return $o; }
function lineTotal(array $l): int { $prod=money($l['amount'])*money($l['quantity']??1); return $prod>=0?intdiv($prod+50,100):intdiv($prod-50,100); }
function totals(array $ls,array $r): array { $base=array_sum(array_map(fn($l)=>lineTotal($l),$ls)); $fund=portion($base,pct($r['fundRate'])); $vat=portion($base+$fund,pct($r['vatRate'])); $withholding=portion($base,pct($r['withholdingRate'])); $stamp=money($r['stamp']); return compact('base','fund','vat','withholding','stamp')+['gross'=>$base+$fund+$vat+$stamp,'net'=>$base+$fund+$vat+$stamp-$withholding]; }
function proQuotaInvoice(array $notice, int $paidAmount, array $existingInvoices): array {
    $netTotal = $notice['totals']['net'];
    demand($netTotal > 0, 'Totale avviso nullo');
    demand($paidAmount > 0, 'Importo incasso nullo o negativo');
    $invoicedNet = 0; $invoicedBase = 0; $invoicedFund = 0; $invoicedVat = 0; $invoicedWithholding = 0; $invoicedStamp = 0;
    foreach ($existingInvoices as $inv) {
        $invoicedNet += $inv['totals']['net'];
        $invoicedBase += $inv['totals']['base'];
        $invoicedFund += $inv['totals']['fund'];
        $invoicedVat += $inv['totals']['vat'];
        $invoicedWithholding += $inv['totals']['withholding'];
        $invoicedStamp += $inv['totals']['stamp'];
    }
    $remainingNet = $netTotal - $invoicedNet;
    demand($paidAmount <= $remainingNet, 'L’importo supera il residuo da fatturare');
    $isFinal = ($paidAmount === $remainingNet);
    if ($isFinal && count($existingInvoices) > 0) {
        $base = $notice['totals']['base'] - $invoicedBase;
        $fund = $notice['totals']['fund'] - $invoicedFund;
        $vat = $notice['totals']['vat'] - $invoicedVat;
        $withholding = $notice['totals']['withholding'] - $invoicedWithholding;
        $stamp = $notice['totals']['stamp'] - $invoicedStamp;
        $gross = $base + $fund + $vat + $stamp;
        $net = $gross - $withholding;
        demand($net === $paidAmount, 'Incoerenza nel saldo finale pro-quota');
        $totals = compact('base', 'fund', 'vat', 'withholding', 'stamp', 'gross', 'net');
        $lines = []; $allocBase = 0;
        foreach ($notice['lines'] as $i => $l) {
            $origTotal = lineTotal($l);
            $prevTotal = 0;
            foreach ($existingInvoices as $inv) if (isset($inv['lines'][$i])) $prevTotal += lineTotal($inv['lines'][$i]);
            $remain = $origTotal - $prevTotal;
            $allocBase += $remain;
            $lines[] = ['description' => $l['description'] . ' (saldo)', 'amount' => (float)($remain / 100), 'quantity' => 1.0, 'basis' => 'item'];
        }
        if ($allocBase !== $base && count($lines) > 0) {
            $diff = $base - $allocBase;
            $lastIdx = count($lines) - 1;
            $lines[$lastIdx]['amount'] = (float)(($lines[$lastIdx]['amount'] * 100 + $diff) / 100);
        }
    } elseif ($paidAmount === $netTotal && empty($existingInvoices)) {
        $totals = $notice['totals'];
        $lines = $notice['lines'];
    } else {
        $alpha = (float)$paidAmount / (float)$netTotal;
        $base = (int)round($notice['totals']['base'] * $alpha);
        $r = $notice['rates'];
        $fund = portion($base, pct($r['fundRate']));
        $vat = portion($base + $fund, pct($r['vatRate']));
        $withholding = portion($base, pct($r['withholdingRate']));
        $stamp = ($invoicedStamp === 0 && !empty($notice['totals']['stamp'])) ? $notice['totals']['stamp'] : 0;
        $gross = $base + $fund + $vat + $stamp;
        $net = $gross - $withholding;
        for ($iter = 0; $iter < 10 && $net !== $paidAmount; $iter++) {
            $base += ($paidAmount - $net);
            $fund = portion($base, pct($r['fundRate']));
            $vat = portion($base + $fund, pct($r['vatRate']));
            $withholding = portion($base, pct($r['withholdingRate']));
            $gross = $base + $fund + $vat + $stamp;
            $net = $gross - $withholding;
        }
        if ($net !== $paidAmount) {
            $base += ($paidAmount - $net);
            $gross = $base + $fund + $vat + $stamp;
            $net = $paidAmount;
        }
        $totals = compact('base', 'fund', 'vat', 'withholding', 'stamp', 'gross', 'net');
        $lines = []; $allocBase = 0; $numLines = count($notice['lines']);
        foreach ($notice['lines'] as $i => $l) {
            if ($i === $numLines - 1) {
                $lAmount = $base - $allocBase;
            } else {
                $ratio = (float)lineTotal($l) / (float)$notice['totals']['base'];
                $lAmount = (int)round($base * $ratio);
                $allocBase += $lAmount;
            }
            $lines[] = ['description' => $l['description'] . ' (acconto pro-quota)', 'amount' => (float)($lAmount / 100), 'quantity' => 1.0, 'basis' => 'item'];
        }
    }
    return ['totals' => $totals, 'lines' => $lines];
}
function defaultServiceRates(): array { return [['key'=>'f24','kind'=>'f24','description'=>'F24 elaborati e trasmessi telematicamente','amount'=>10.0],['key'=>'visura','kind'=>'visura','description'=>'Richiesta visure camerali','amount'=>10.0],['key'=>'cciaa','kind'=>'cciaa','description'=>'Pratiche CCIAA','amount'=>100.0],['key'=>'ade','kind'=>'ade','description'=>'Pratiche Agenzia delle Entrate','amount'=>100.0],['key'=>'visto','kind'=>'visto','description'=>'Visto di conformità','amount'=>300.0]]; }
function serviceRates(array $items): array { demand(count($items)>0 && count($items)<=100,'Inserire da 1 a 100 voci nel tariffario'); return array_map(function($r){$d=textval($r['description']??''); demand($d!=='','Descrizione prestazione obbligatoria'); $a=money($r['amount']??0); $k=textval($r['kind']??'custom',50); $key=textval($r['key']??'',50); return ['key'=>$key?:ident(),'kind'=>$k?:'custom','description'=>$d,'amount'=>(float)($a/100)];},$items); }
function initialState(): array { return ['revision'=>0,'studio'=>['name'=>'','vatRate'=>22,'fundRate'=>4,'withholdingRate'=>20,'stamp'=>0,'nature'=>'N2.2','regime'=>'RF01','fundType'=>'TC02','withholdingType'=>'RT02','iban'=>''],'serviceRates'=>defaultServiceRates(),'clients'=>[],'notices'=>[],'invoices'=>[],'counters'=>[],'audit'=>[]]; }
function nextNumber(array &$s,string $type,string $date): string { $key=$type.substr($date,0,4); $s['counters'][$key]=($s['counters'][$key]??0)+1; return ($type==='A'?'A/':'').substr($date,0,4).'/'.str_pad((string)$s['counters'][$key],4,'0',STR_PAD_LEFT); }
function nextDate(string $date,int $months,int $anchor): string { $d=new DateTimeImmutable(substr($date,0,7).'-01'); $d=$d->modify("+$months months"); return $d->format('Y-m-').str_pad((string)min($anchor,(int)$d->format('t')),2,'0',STR_PAD_LEFT); }
function mutate(array &$s,string $op,array $p,string $actor): mixed {
 $result=null;
 if($op==='studio') { $s['studio']=party($p)+rates($p); foreach(['regime','fundType','withholdingType'] as $k)$s['studio'][$k]=textval($p[$k]??'',4); demand(in_array($s['studio']['regime'],['RF01','RF19'],true),'Regime non supportato'); demand(preg_match('/^TC(0[1-9]|1[0-9]|2[0-2])$/',$s['studio']['fundType'])===1,'Tipo cassa non valido'); demand(in_array($s['studio']['withholdingType'],['RT01','RT02'],true),'Tipo ritenuta non valido'); }
 elseif($op==='client') { $id=textval($p['id']??'',100)?:ident(); $c=party($p)+rates($p); $channel=(string)($p['deliveryChannel']??($c['sdi']!==''?'sdi':($c['pec']!==''?'pec':''))); demand(in_array($channel,['','sdi','pec'],true),'Preferenza invio non valida'); if($channel==='sdi'){demand(preg_match('/^[A-Z0-9]{7}$/',$c['sdi'])===1,'Codice destinatario: inserire 7 caratteri');$c['pec']='';} elseif($channel==='pec'){demand(filter_var($c['pec'],FILTER_VALIDATE_EMAIL)!==false,'PEC non valida');$c['sdi']='';} else {$c['sdi']='';$c['pec']='';} $c['deliveryChannel']=$channel; $c['id']=$id; $c['dossierId']=textval($p['dossierId']??'',100); $c['lines']=lines($p['lines']??[]); $c['months']=(int)($p['months']??0); demand(in_array($c['months'],[0,1,2,3,4,6,12],true),'Periodicità non valida'); $c['nextDate']=day($p['nextDate']??date('Y-m-d')); $c['anchor']=(int)substr($c['nextDate'],8,2); $c['days']=0; demand($c['days']>=0 && $c['days']<=365,'Termine pagamento non valido'); $c['active']=!empty($p['active']); $s['clients'][$id]=$c; $result=$id; }
 elseif($op==='notice'||$op==='notice_update') {
  $old=null;
  if($op==='notice_update'){$old=$s['notices'][$p['id']??'']??null;demand($old!==null,'Avviso non trovato');demand(!$old['cancelled']&&!$old['payments']&&empty($old['invoiceId']),'Modifica consentita solo per avvisi senza incassi e senza fattura');}
  $id=(string)($p['clientId']??'');demand(isset($s['clients'][$id]),'Cliente non trovato');$c=$s['clients'][$id];
  $date=day($p['date']);$due=$date;demand($due>=$date,'La scadenza precede la data');if($old)demand(substr($date,0,4)===substr($old['date'],0,4),'La modifica deve mantenere l’anno della numerazione');
  $ls=lines($p['lines']);$r=rates($p);$period=referencePeriod($p);$serviceDescription=textval($p['serviceDescription']??'',200);$note=textval($p['note']??'');
  $key=textval($old['recurrenceKey']??$p['recurrenceKey']??'',160);$n=$old['id']??ident();
  $s['notices'][$n]=['id'=>$n,'number'=>$old['number']??nextNumber($s,'A',$date),'clientId'=>$id,'client'=>$c,'studio'=>$old['studio']??$s['studio'],'date'=>$date,'due'=>$due,'lines'=>$ls,'rates'=>$r,'totals'=>totals($ls,$r),'note'=>$note,'period'=>$period,'serviceDescription'=>$serviceDescription,'payments'=>[],'cancelled'=>false,'recurrenceKey'=>$key];$result=$n;
 }
 elseif($op==='quarter_bulk') { $result=generateQuarterly($s,$p,$actor); }
 elseif($op==='recurring') { $through=day($p['through']); $count=0; $processed=0; foreach(array_keys($s['clients']) as $id){ $c=&$s['clients'][$id]; if(!$c['active']||!$c['months'])continue; while($c['nextDate']<=$through){demand(++$processed<=500,'Troppi avvisi: scegliere un periodo più breve'); $date=$c['nextDate']; $key=$id.':'.$date; $exists=false; foreach($s['notices'] as $notice) if(($notice['recurrenceKey']??'')===$key)$exists=true; if(!$exists){$count++; mutate($s,'notice',$c+['recurrenceKey'=>$key,'clientId'=>$id,'date'=>$date,'due'=>$date],$actor);} $c['nextDate']=nextDate($date,$c['months'],$c['anchor']); } unset($c); } $result=$count; }
 elseif($op==='payment') { $id=$p['id']??''; demand(isset($s['notices'][$id]),'Avviso non trovato'); $n=&$s['notices'][$id]; demand(!$n['cancelled'],'Avviso annullato'); $amount=money($p['amount']); $paid=array_sum(array_column($n['payments'],'amount')); demand($amount>0 && $paid+$amount<=$n['totals']['net'],'Importo superiore al residuo o nullo'); $date=day($p['date']); demand($date>=$n['date'] && $date<=date('Y-m-d'),'Data incasso non valida'); $n['payments'][]=['id'=>ident(),'date'=>$date,'amount'=>$amount,'reference'=>textval($p['reference']??'',200),'invoiceId'=>'']; }
 elseif($op==='cancel') { $id=$p['id']??''; demand(isset($s['notices'][$id]),'Avviso non trovato'); $n=&$s['notices'][$id]; demand(!$n['payments'] && empty($n['invoiceIds']) && empty($n['invoiceId']),'Un avviso con incassi o fattura non può essere annullato'); $n['cancelled']=true; }
  elseif($op==='invoice') {
   $id=$p['id']??''; demand(isset($s['notices'][$id]),'Avviso non trovato');
   $n=&$s['notices'][$id];
   demand(!$n['cancelled'],'Avviso annullato');
   demand(!empty($n['payments']),'Nessun incasso registrato per questo avviso');
   $targetPaymentId=(string)($p['paymentId']??'');
   $targetPayments=[];
   if($targetPaymentId!==''){
       foreach($n['payments'] as $pm){
           if($pm['id']===$targetPaymentId){
               demand(empty($pm['invoiceId']),'Questo incasso è già stato fatturato');
               $targetPayments[]=$pm;
               break;
           }
       }
       demand(!empty($targetPayments),'Incasso specificato non trovato');
   } else {
       foreach($n['payments'] as $pm){
           if(empty($pm['invoiceId']))$targetPayments[]=$pm;
       }
       demand(!empty($targetPayments),'Tutti gli incassi registrati per questo avviso sono già stati fatturati');
   }
   $paidAmount=array_sum(array_column($targetPayments,'amount'));
   $latest=max(array_column($targetPayments,'date'));
   $date=day($p['date']??date('Y-m-d'));
   demand($date>=$latest && $date<=date('Y-m-d'),'La data fattura deve essere compresa fra data incasso e oggi');
   foreach($s['invoices'] as $old) if(substr($old['date'],0,4)===substr($date,0,4))demand($date>=$old['date'],'Data precedente all’ultima fattura numerata');
   $existingInvoices=[];
   foreach($s['invoices'] as $inv) if(($inv['noticeId']??'')===$id)$existingInvoices[]=$inv;
   $calc=proQuotaInvoice($n,$paidAmount,$existingInvoices);
   $f=$n;
   $f['id']=ident();
   $f['noticeId']=$id;
   $f['noticeNumber']=$n['number'];
   $f['paymentId']=count($targetPayments)===1?$targetPayments[0]['id']:'';
   $f['paymentIds']=array_column($targetPayments,'id');
   $f['paymentDate']=$latest;
   $f['paymentReference']=implode(', ',array_filter(array_column($targetPayments,'reference')));
   $f['date']=$date;
   $f['client']=$s['clients'][$n['clientId']];
   $f['studio']=$s['studio'];
   $f['number']=nextNumber($s,'F',$date);
   $f['status']='da_inviare';
   $f['transmissionReference']='';
   $f['totals']=$calc['totals'];
   $f['lines']=$calc['lines'];
   $f['rates']=$n['rates'];
   $f['xml']=invoiceXml($f);
   validateXml($f['xml']);
   $f['sha256']=hash('sha256',$f['xml']);
   $f['filename']='IT'.$f['studio']['cf'].'_'.str_pad(base_convert((string)($s['counters']['F'.substr($date,0,4)]),10,36),5,'0',STR_PAD_LEFT).substr($date,2,2).'.xml';
   $s['invoices'][$f['id']]=$f;
   foreach($n['payments'] as &$pm){
       if(in_array($pm['id'],$f['paymentIds'],true))$pm['invoiceId']=$f['id'];
   }
   unset($pm);
   if(!isset($n['invoiceIds']))$n['invoiceIds']=!empty($n['invoiceId'])?[$n['invoiceId']]:[];
   $n['invoiceIds'][]=$f['id'];
   $n['invoiceId']=$f['id'];
   $result=$f['id'];
  }
 elseif($op==='numbering') { $year=(string)($p['year']??''); demand(preg_match('/^20[0-9]{2}$/',$year)===1,'Anno non valido'); $last=filter_var($p['last']??null,FILTER_VALIDATE_INT); demand($last!==false && $last>=0 && $last<=999999,'Ultimo numero non valido'); demand($last>=($s['counters']['F'.$year]??0),'Il progressivo non può diminuire'); $s['counters']['F'.$year]=$last; }
 elseif($op==='status') { $id=$p['id']??''; demand(isset($s['invoices'][$id]),'Fattura non trovata'); $status=$p['status']??''; demand(in_array($status,['da_inviare','inviata','consegnata','mancata_consegna','scartata'],true),'Stato non valido'); $ref=textval($p['reference']??'',200); demand($status==='da_inviare'||$ref!=='','Inserire riferimento trasmissione o ricevuta'); $s['invoices'][$id]['status']=$status; $s['invoices'][$id]['transmissionReference']=$ref; }
 elseif($op==='service_rates') { $s['serviceRates']=serviceRates($p['rates']??[]); $result=count($s['serviceRates']); }
 else throw new DomainException('Operazione sconosciuta');
 $s['audit'][]=['at'=>date(DATE_ATOM),'actor'=>$actor,'operation'=>$op,'id'=>$result??($p['id']??'' )]; return $result;
}

function invoiceXml(array $f): string {
 $c=$f['client']; $s=$f['studio']; $r=$f['rates']; $t=$f['totals'];
 foreach(['studio'=>$s,'cliente'=>$c] as $who=>$a){ foreach(['name','address','city','zip','province'] as $k)demand(!empty($a[$k]),"Dati mancanti: $who / $k"); demand(preg_match('/^\d{5}$/',$a['zip'])===1,"CAP $who non valido"); demand(preg_match('/^[A-Z]{2}$/',$a['province'])===1,"Provincia $who non valida"); demand(preg_match('/^(\d{11}|[A-Z0-9]{16})$/',$a['cf'])===1,"Codice fiscale $who non valido"); if($a['vat']!=='')demand(preg_match('/^\d{11}$/',$a['vat'])===1,"Partita IVA $who non valida"); }
 demand(preg_match('/^\d{11}$/',$s['vat'])===1,'Partita IVA studio obbligatoria'); demand(in_array($s['regime']??'', ['RF01','RF19'],true),'Configurare il regime dello studio');
 demand($s['regime']!=='RF19'||($r['vatRate']==0 && $r['withholdingRate']==0),'Configurazione forfettario incoerente: verificare IVA e ritenuta');
 demand($c['sdi']===''||preg_match('/^[A-Z0-9]{7}$/',$c['sdi'])===1,'Sono supportati destinatari privati italiani: codice SDI di 7 caratteri'); demand($c['pec']===''||filter_var($c['pec'],FILTER_VALIDATE_EMAIL)!==false,'PEC non valida');
 $x=fn($v)=>htmlspecialchars((string)$v,ENT_XML1|ENT_QUOTES,'UTF-8'); $m=fn($v)=>number_format($v/100,2,'.',''); $tag=fn($name,$value)=>'<'.$name.'>'.$x($value).'</'.$name.'>'; $nat=$r['vatRate']==0?$tag('Natura',$r['nature']):'';
 $an=function($a,$supplier)use($tag){return '<DatiAnagrafici>'.($a['vat']!==''?'<IdFiscaleIVA><IdPaese>IT</IdPaese>'.$tag('IdCodice',$a['vat']).'</IdFiscaleIVA>':'').$tag('CodiceFiscale',$a['cf']).'<Anagrafica>'.$tag('Denominazione',$a['name']).'</Anagrafica>'.($supplier?$tag('RegimeFiscale',$a['regime']):'').'</DatiAnagrafici><Sede>'.$tag('Indirizzo',$a['address']).$tag('CAP',$a['zip']).$tag('Comune',$a['city']).$tag('Provincia',$a['province']).'<Nazione>IT</Nazione></Sede>';};
 $xml='<?xml version="1.0" encoding="UTF-8"?><p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12"><FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese>'.$tag('IdCodice',$s['cf']).'</IdTrasmittente>'.$tag('ProgressivoInvio',str_replace('/','',$f['number'])).'<FormatoTrasmissione>FPR12</FormatoTrasmissione>'.$tag('CodiceDestinatario',$c['sdi']?:'0000000').($c['pec']!==''?$tag('PECDestinatario',$c['pec']):'').'</DatiTrasmissione><CedentePrestatore>'.$an($s,true).'</CedentePrestatore><CessionarioCommittente>'.$an($c,false).'</CessionarioCommittente></FatturaElettronicaHeader><FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa>'.$tag('Data',$f['date']).$tag('Numero',$f['number']);
 if($t['withholding'])$xml.='<DatiRitenuta>'.$tag('TipoRitenuta',$s['withholdingType']).$tag('ImportoRitenuta',$m($t['withholding'])).$tag('AliquotaRitenuta',number_format($r['withholdingRate'],2,'.','')).'<CausalePagamento>A</CausalePagamento></DatiRitenuta>';
 if($t['stamp'])$xml.='<DatiBollo><BolloVirtuale>SI</BolloVirtuale>'.$tag('ImportoBollo',$m($t['stamp'])).'</DatiBollo>';
 if($t['fund'])$xml.='<DatiCassaPrevidenziale>'.$tag('TipoCassa',$s['fundType']).$tag('AlCassa',number_format($r['fundRate'],2,'.','')).$tag('ImportoContributoCassa',$m($t['fund'])).$tag('ImponibileCassa',$m($t['base'])).$tag('AliquotaIVA',number_format($r['vatRate'],2,'.','')).$nat.'</DatiCassaPrevidenziale>';
 $causaleNotice='Rif. avviso '.$f['noticeNumber'].(!empty($f['paymentDate'])?' · Quota incasso del '.date('d/m/Y',strtotime($f['paymentDate'])):'');
 $xml.=$tag('ImportoTotaleDocumento',$m($t['gross'])).$tag('Causale',$causaleNotice).(!empty($f['period'])?$tag('Causale','Periodo di riferimento: '.$f['period']['label']):'').(!empty($f['serviceDescription'])?$tag('Causale',$f['serviceDescription']):'').'</DatiGeneraliDocumento></DatiGenerali><DatiBeniServizi>';
 foreach($f['lines'] as $i=>$l)$xml.='<DettaglioLinee>'.$tag('NumeroLinea',$i+1).$tag('Descrizione',$l['description']).$tag('Quantita',number_format($l['quantity']??1,2,'.','')).$tag('PrezzoUnitario',number_format($l['amount'],2,'.','')).$tag('PrezzoTotale',$m(lineTotal($l))).$tag('AliquotaIVA',number_format($r['vatRate'],2,'.','')).($t['withholding']?'<Ritenuta>SI</Ritenuta>':'').$nat.'</DettaglioLinee>';
 if($t['stamp'])$xml.='<DettaglioLinee>'.$tag('NumeroLinea',count($f['lines'])+1).'<Descrizione>Bollo addebitato</Descrizione>'.$tag('PrezzoUnitario',$m($t['stamp'])).$tag('PrezzoTotale',$m($t['stamp'])).'<AliquotaIVA>0.00</AliquotaIVA><Natura>N1</Natura></DettaglioLinee>';
 $combined=$r['vatRate']==0 && $r['nature']==='N1';
 $xml.='<DatiRiepilogo>'.$tag('AliquotaIVA',number_format($r['vatRate'],2,'.','')).$nat.$tag('ImponibileImporto',$m($t['base']+$t['fund']+($combined?$t['stamp']:0))).$tag('Imposta',$m($t['vat'])).'<EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo>';
 if($t['stamp']&&!$combined)$xml.='<DatiRiepilogo><AliquotaIVA>0.00</AliquotaIVA><Natura>N1</Natura>'.$tag('ImponibileImporto',$m($t['stamp'])).'<Imposta>0.00</Imposta></DatiRiepilogo>';
 return $xml.'</DatiBeniServizi><DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento>'.$tag('DataScadenzaPagamento',$f['date']).$tag('ImportoPagamento',$m($t['net'])).($s['iban']!==''?$tag('IBAN',preg_replace('/\s/','',$s['iban'])):'').'</DettaglioPagamento></DatiPagamento></FatturaElettronicaBody></p:FatturaElettronica>';
}
function validateXml(string $xml): void { demand(is_file(__DIR__.'/schema/fatturapa.xsd'),'Schema ufficiale XSD non installato: emissione bloccata'); libxml_use_internal_errors(true); $dom=new DOMDocument(); demand($dom->loadXML($xml,LIBXML_NONET),'XML non valido'); $ok=$dom->schemaValidate(__DIR__.'/schema/fatturapa.xsd'); $errors=array_map(fn($e)=>trim($e->message),libxml_get_errors()); libxml_clear_errors(); demand($ok,'XML non conforme allo schema: '.implode('; ',$errors)); }
