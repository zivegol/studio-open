<?php
declare(strict_types=1);
require_once __DIR__.'/domain.php';
require_once __DIR__.'/db.php';
require_once __DIR__.'/dossier-address.php';
require_once __DIR__.'/email.php';
require_once __DIR__.'/dossier-profile.php';
define('OC_APP',true);
header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');
function fail(int $code,string $message): never { http_response_code($code); echo json_encode(['error'=>$message],JSON_UNESCAPED_UNICODE); exit; }
require_once dirname(__DIR__,2).'/lib/base.php';
$user=\OC::$server->getUserSession()->getUser();
if(!$user)fail(401,'Accedere a Nextcloud per utilizzare l’archivio parcelle');
$uid=$user->getUID();
if(!\OC::$server->getGroupManager()->isAdmin($uid) && !in_array(strtolower($uid),['studio-example'],true))fail(403,'Utente non autorizzato');
$op=(string)($_GET['op']??'state');
$method=$_SERVER['REQUEST_METHOD']??'GET';
if($method!=='GET'){
 if($method!=='POST')fail(405,'Metodo non consentito');
 if(($_SERVER['HTTP_X_PARCELLE_REQUEST']??'')!=='1')fail(403,'Richiesta non valida');
 if(($_SERVER['HTTP_SEC_FETCH_SITE']??'same-origin')==='cross-site')fail(403,'Origine non consentita');
 if(isset($_SERVER['HTTP_ORIGIN']) && parse_url($_SERVER['HTTP_ORIGIN'],PHP_URL_HOST)!==explode(':',$_SERVER['HTTP_HOST'])[0])fail(403,'Origine non consentita');
}
$db=null;
try {
 if($method==='GET' && $op==='dossier'){
  $indexPath=\OC::$server->getConfig()->getSystemValue('datadirectory',\OC::$SERVERROOT.'/data').'/admin/files/Studio/DossierClienti/private/dossier-index.json';
  demand(is_file($indexPath),'Indice Dossier non disponibile');
  $index=json_decode(file_get_contents($indexPath),true,512,JSON_THROW_ON_ERROR);
  $clientId=(string)($_GET['clientId']??'');
  if($clientId!==''){foreach($index['clients']??[] as $client)if(($client['clientId']??'')===$clientId){echo json_encode(['clientId'=>$clientId,'identity'=>$client['identity'],'billingAddress'=>dossierAddress((string)\OC::$server->getConfig()->getSystemValue('datadirectory',\OC::$SERVERROOT.'/data'),$clientId)],JSON_UNESCAPED_UNICODE);exit;}fail(404,'Cliente Dossier non trovato');}
  echo json_encode(['clients'=>array_map(fn($c)=>['clientId'=>$c['clientId'],'displayName'=>$c['identity']['displayName']??'Cliente'], $index['clients']??[])],JSON_UNESCAPED_UNICODE);exit;
 }
 $dir=\OC::$server->getConfig()->getSystemValue('datadirectory',\OC::$SERVERROOT.'/data').'/studio-parcelle';
 if(!is_dir($dir)&&!mkdir($dir,0700,true))throw new RuntimeException('Archivio non disponibile');
 
 $db = getDb($dir.'/parcelle.sqlite');
 checkAndMigrateLegacy($db);

 if($method==='GET' && $op==='dossier_profile'){
  $indexPath=\OC::$server->getConfig()->getSystemValue('datadirectory',\OC::$SERVERROOT.'/data').'/admin/files/Studio/DossierClienti/private/dossier-index.json';
  demand(is_file($indexPath),'Indice Dossier non disponibile');
  $index=json_decode(file_get_contents($indexPath),true,512,JSON_THROW_ON_ERROR);
  $clientId=(string)($_GET['clientId']??'');
  foreach($index['clients']??[] as $client) if(($client['clientId']??'')===$clientId){
   echo json_encode(dossierProfile(loadStateFromDb($db),$client),JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);exit;
  }
  fail(404,'Cliente Dossier non trovato');
 }

 if($method==='GET'){
  if($op==='xml'){
   $invId=(string)($_GET['id']??'');
   $stmt=$db->prepare('SELECT filename, xml_content FROM invoices WHERE id = ?');
   $stmt->execute([$invId]);
   $f=$stmt->fetch(PDO::FETCH_ASSOC);
   if(!$f||empty($f['xml_content']))fail(404,'Fattura XML non trovata');
   header('Content-Type: application/xml; charset=utf-8');
   header('Content-Disposition: attachment; filename="'.$f['filename'].'"');
   echo $f['xml_content'];
   exit;
  }
  if($op==='backup'){
   $sFull=loadStateFromDb($db, true);
   header('Content-Disposition: attachment; filename="parcelle-backup-'.date('Ymd').'.json"');
   echo json_encode($sFull,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE);
   exit;
  }
  if($op==='backup_db'){
   $tmpBkp = sys_get_temp_dir() . '/parcelle-backup-' . date('Ymd-His') . '.sqlite';
   if(file_exists($tmpBkp)) unlink($tmpBkp);
   $db->exec('VACUUM INTO ' . $db->quote($tmpBkp));
   header('Content-Type: application/x-sqlite3');
   header('Content-Disposition: attachment; filename="parcelle-backup-'.date('Ymd-His').'.sqlite"');
   header('Content-Length: ' . filesize($tmpBkp));
   readfile($tmpBkp);
   unlink($tmpBkp);
   exit;
  }
  $s=loadStateFromDb($db, false);
  if($op==='email_preview'){
   $nid=(string)($_GET['noticeId']??'');
   demand(isset($s['notices'][$nid]),'Avviso non trovato');
   $notice=$s['notices'][$nid];
   $preview=buildNoticeEmailData($notice,$s['studio']);
   echo json_encode(['ok'=>true,'email'=>$preview],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
   exit;
  }
  if($op==='adempimenti'){
   require_once __DIR__.'/adempimenti.php';
   $clientId=(string)($_GET['clientId']??'');
   demand(isset($s['clients'][$clientId]),'Cliente non trovato');
   $client=$s['clients'][$clientId];
   $year=(int)($_GET['year']??date('Y'));
   $qParam=(string)($_GET['quarters']??'');
   $quarters=$qParam!==''?array_map('intval',explode(',',$qParam)):[1];
   $rates=$s['serviceRates']??defaultServiceRates();
   $res=getClientAdempimentiForQuarters($client,$quarters,$year,$rates,$db);
   echo json_encode($res,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);exit;
  }
  if($op==='adempimenti_all'){
   require_once __DIR__.'/adempimenti.php';
   $year=(int)($_GET['year']??date('Y'));
   $res=loadAdempimentiData($year,$db);
   echo json_encode($res,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);exit;
  }
  if($op==='adempimenti_export_csv'){
   require_once __DIR__.'/adempimenti.php';
   $year=(int)($_GET['year']??date('Y'));
   $csv=exportAdempimentiCsv($db,$year);
   header('Content-Type: text/csv; charset=utf-8');
   header('Content-Disposition: attachment; filename="registro-adempimenti-'.$year.'.csv"');
   echo $csv;
   exit;
  }
  demand($op==='state','Operazione non consentita');
 } else {
  $raw=file_get_contents('php://input',false,null,0,2000001); demand(strlen($raw)<=2000000,'Richiesta troppo grande'); $input=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
  $s=loadStateFromDb($db, false);

  if($op==='send_email'){
   $nid=(string)($input['payload']['noticeId']??'');
   $toEmail=trim((string)($input['payload']['toEmail']??''));
   demand(isset($s['notices'][$nid]),'Avviso non trovato');
   demand(!$s['notices'][$nid]['cancelled'],'Avviso annullato');
   demand(filter_var($toEmail,FILTER_VALIDATE_EMAIL)!==false,'Indirizzo email destinatario non valido: '.$toEmail);
   $subject=!empty($input['payload']['subject'])?textval($input['payload']['subject'],250):null;
   $bodyText=!empty($input['payload']['bodyText'])?(string)$input['payload']['bodyText']:null;
   $bodyHtml=!empty($input['payload']['bodyHtml'])?(string)$input['payload']['bodyHtml']:null;
   
   sendNoticeEmailViaMailer($s['notices'][$nid],$toEmail,$subject,$bodyText,$bodyHtml);
   $info=recordNoticeEmailSent($db,$nid,$toEmail,$uid);
   if(!empty($input['payload']['updateClientEmail']) && !empty($s['notices'][$nid]['clientId'])){
       updateClientEmail($db,$s['notices'][$nid]['clientId'],$toEmail,$uid);
   }
   $s=loadStateFromDb($db,false);
   if(empty($s['serviceRates']))$s['serviceRates']=defaultServiceRates();
   foreach($s['invoices'] as &$invoice)unset($invoice['xml']);unset($invoice);
   echo json_encode(['ok'=>true,'state'=>$s,'sentEmail'=>$info],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
   exit;
  }

  if($op==='bulk_send_emails'){
   $items=$input['payload']['items']??[];
   demand(is_array($items)&&count($items)>0,'Nessun avviso selezionato per la spedizione');
   demand(count($items)<=200,'Massimo 200 email per invio massivo');
   $sentCount=0;
   $errors=[];
   foreach($items as $item){
       $nid=(string)($item['noticeId']??'');
       $toEmail=trim((string)($item['toEmail']??''));
       if(!isset($s['notices'][$nid])){
           $errors[]=['noticeId'=>$nid,'error'=>'Avviso non trovato'];
           continue;
       }
       if($s['notices'][$nid]['cancelled']){
           $errors[]=['noticeId'=>$nid,'error'=>'Avviso annullato'];
           continue;
       }
       if(filter_var($toEmail,FILTER_VALIDATE_EMAIL)===false){
           $errors[]=['noticeId'=>$nid,'error'=>'Indirizzo email non valido ('.$toEmail.')'];
           continue;
       }
       try {
           sendNoticeEmailViaMailer($s['notices'][$nid],$toEmail);
           recordNoticeEmailSent($db,$nid,$toEmail,$uid);
           if(!empty($s['notices'][$nid]['clientId'])){
               $cid=$s['notices'][$nid]['clientId'];
               if(empty($s['clients'][$cid]['email'])||$s['clients'][$cid]['email']!==$toEmail){
                   updateClientEmail($db,$cid,$toEmail,$uid);
               }
           }
           $sentCount++;
       }catch(Throwable $e){
           $errors[]=['noticeId'=>$nid,'error'=>$e->getMessage()];
       }
   }
   $s=loadStateFromDb($db,false);
   if(empty($s['serviceRates']))$s['serviceRates']=defaultServiceRates();
   foreach($s['invoices'] as &$invoice)unset($invoice['xml']);unset($invoice);
   echo json_encode(['ok'=>true,'state'=>$s,'sentCount'=>$sentCount,'errors'=>$errors],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
   exit;
  }

  if($op==='update_client_email'){
   $cid=(string)($input['payload']['clientId']??'');
   $email=trim((string)($input['payload']['email']??''));
   demand(isset($s['clients'][$cid]),'Cliente non trovato');
   if($email!==''){
    demand(filter_var($email,FILTER_VALIDATE_EMAIL)!==false,'Indirizzo email non valido');
   }
   updateClientEmail($db,$cid,$email,$uid);
   $s=loadStateFromDb($db,false);
   if(empty($s['serviceRates']))$s['serviceRates']=defaultServiceRates();
   foreach($s['invoices'] as &$invoice)unset($invoice['xml']);unset($invoice);
   echo json_encode(['ok'=>true,'state'=>$s],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
   exit;
  }

  if($op==='adempimento_cell_save'){
   require_once __DIR__.'/adempimenti.php';
   $p=$input['payload']??[];
   $clientName=(string)($p['clientName']??'');
   $year=(int)($p['year']??date('Y'));
   $month=(int)($p['month']??1);
   $text=(string)($p['text']??'');
   $rates=$s['serviceRates']??defaultServiceRates();
   $res=saveAdempimentoCell($db,$clientName,$year,$month,$text,$uid,$rates);
   echo json_encode(['ok'=>true,'cell'=>$res],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
   exit;
  }

  if($op==='adempimenti_add_client'){
   require_once __DIR__.'/adempimenti.php';
   $p=$input['payload']??[];
   $name=(string)($p['name']??'');
   $vat=(string)($p['vat']??'');
   $cf=(string)($p['cf']??'');
   $res=addAdempimentiClient($db,$name,$vat,$cf,$uid);
   echo json_encode(['ok'=>true,'client'=>$res],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
   exit;
  }

  $db->exec('BEGIN IMMEDIATE');
  $s=loadStateFromDb($db, false);
  if(($input['revision']??-1)!==$s['revision']){$db->exec('ROLLBACK');fail(409,'Archivio aggiornato da un altro operatore. Ricaricare e ripetere l’operazione.');}
  if($op==='quarter_preview'){$plan=quarterlyPlan($s,$input['payload']??[]);$db->exec('ROLLBACK');echo json_encode(['preview'=>$plan],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);exit;}
  $oldState=$s;
  $result=mutate($s,$op,$input['payload']??[],$uid);$s['revision']++;
  persistDiffToDb($db,$oldState,$s,$op,$uid);
  $db->exec('COMMIT');
 }
 if(empty($s['serviceRates']))$s['serviceRates']=defaultServiceRates();
 foreach($s['invoices'] as &$invoice)unset($invoice['xml']);unset($invoice);
 echo json_encode(['state'=>$s,'result'=>$result??null],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
}catch(DomainException|JsonException $e){if($db){try{$db->exec('ROLLBACK');}catch(Throwable){}}fail(422,$e->getMessage());}
catch(Throwable $e){if($db){try{$db->exec('ROLLBACK');}catch(Throwable){}}error_log('Parcelle: '.$e->getMessage());fail(500,'Archivio non disponibile: '.$e->getMessage());}
