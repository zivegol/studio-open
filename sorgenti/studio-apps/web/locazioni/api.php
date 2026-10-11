<?php
declare(strict_types=1);
require_once __DIR__.'/domain.php';
header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
function loc_fail(int $code,string $message): never {http_response_code($code);echo json_encode(['error'=>$message],JSON_UNESCAPED_UNICODE);exit;}
// Resolve the Nextcloud root from its studio-apps/locazioni directory.
require_once dirname(__DIR__,2).'/lib/base.php';
$user=\OC::$server->getUserSession()->getUser();if(!$user)loc_fail(401,'Accedi a Nextcloud per aprire il tuo archivio locazioni.');
$method=$_SERVER['REQUEST_METHOD']??'GET';if(!in_array($method,['GET','POST'],true))loc_fail(405,'Metodo non consentito');
if($method==='POST'){
 if(($_SERVER['HTTP_X_LOCAZIONI_REQUEST']??'')!=='1')loc_fail(403,'Richiesta non valida');
 if(!str_starts_with(strtolower($_SERVER['CONTENT_TYPE']??''),'application/json'))loc_fail(415,'Formato non consentito');
 if(isset($_SERVER['HTTP_SEC_FETCH_SITE'])&&$_SERVER['HTTP_SEC_FETCH_SITE']!=='same-origin')loc_fail(403,'Origine non consentita');
 if(isset($_SERVER['HTTP_ORIGIN'])){$origin=parse_url($_SERVER['HTTP_ORIGIN']);$host=($origin['host']??'').(isset($origin['port'])?':'.$origin['port']:'');if(strtolower($host)!==strtolower($_SERVER['HTTP_HOST']??''))loc_fail(403,'Origine non consentita');}
}
try {
 $base=\OC::$server->getConfig()->getSystemValue('datadirectory',\OC::$SERVERROOT.'/data').'/studio-locazioni';
 if(!is_dir($base)&&!mkdir($base,0700,true))throw new RuntimeException('Storage');
 // Each Nextcloud account has its own archive; no cross-user path is accepted.
 $db=new PDO('sqlite:'.$base.'/'.hash('sha256',$user->getUID()).'.sqlite');$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);$db->exec('PRAGMA busy_timeout=10000');
 $db->exec('CREATE TABLE IF NOT EXISTS archive (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL)');
 $db->prepare('INSERT OR IGNORE INTO archive VALUES (1,0,?)')->execute([json_encode(loc_empty())]);
 if($method==='POST'){
  $raw=file_get_contents('php://input',false,null,0,4000001);if(strlen($raw)>4000000)loc_fail(413,'Archivio troppo grande');
  $input=json_decode($raw,true,512,JSON_THROW_ON_ERROR);loc_demand(is_array($input)&&is_int($input['revision']??null)&&is_array($input['state']??null),'Richiesta non valida');
  $state=loc_validate($input['state']);$db->exec('BEGIN IMMEDIATE');$current=$db->query('SELECT revision,body FROM archive WHERE id=1')->fetch(PDO::FETCH_ASSOC);
  if((int)$current['revision']!==$input['revision']){$db->exec('ROLLBACK');loc_fail(409,'Archivio aggiornato in un’altra scheda. Ricarica prima di riprovare.');}
  // Keep previously recorded receipts and their original details; cancellation is explicit.
  $old=json_decode($current['body'],true);$newPayments=array_column($state['payments'],null,'id');
  loc_preserve_history($old,$state);
  foreach($old['payments'] as $p){$n=$newPayments[$p['id']]??null;loc_demand($n!==null,'Gli incassi registrati non possono essere eliminati');foreach(['contractId','installmentKey','date','amountCents','reference'] as $key)loc_demand($p[$key]===$n[$key],'Per correggere un incasso annullalo e registralo nuovamente');}
  $db->prepare('UPDATE archive SET revision=revision+1,body=? WHERE id=1')->execute([json_encode($state,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);$db->exec('COMMIT');
 }
 $r=$db->query('SELECT revision,body FROM archive WHERE id=1')->fetch(PDO::FETCH_ASSOC);
 echo json_encode(['revision'=>(int)$r['revision'],'state'=>json_decode($r['body'],true),'user'=>$user->getDisplayName()],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
}catch(DomainException|JsonException $e){if(isset($db))try{$db->exec('ROLLBACK');}catch(Throwable $ignored){}loc_fail(422,$e->getMessage());}
catch(Throwable $e){if(isset($db))try{$db->exec('ROLLBACK');}catch(Throwable $ignored){}error_log('Locazioni: errore archivio ('.get_class($e).')');loc_fail(500,'Archivio non disponibile. Nessuna modifica confermata.');}
