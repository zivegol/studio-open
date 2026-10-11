<?php
declare(strict_types=1);
define('OC_APP', true);
require_once '/var/www/html/lib/base.php';
header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');
function reject(int $code, string $message): never {http_response_code($code); echo json_encode(['error'=>$message]); exit;}
$user=\OC::$server->getUserSession()->getUser();
if(!$user) reject(401,'Accedere a Nextcloud');
$uid=$user->getUID();
// Same authorization as the actual Dossier API: administrators only.
if(!\OC::$server->getGroupManager()->isAdmin($uid)) reject(403,'Utente non autorizzato');
if(($_SERVER['REQUEST_METHOD']??'')!=='POST') reject(405,'Metodo non consentito');
if(($_SERVER['HTTP_X_CESSIONI_REQUEST']??'')!=='1') reject(403,'Richiesta non valida');
if(($_SERVER['HTTP_SEC_FETCH_SITE']??'same-origin')==='cross-site') reject(403,'Origine non consentita');
if(isset($_SERVER['HTTP_ORIGIN']) && parse_url($_SERVER['HTTP_ORIGIN'],PHP_URL_HOST)!==explode(':',$_SERVER['HTTP_HOST'])[0]) reject(403,'Origine non consentita');
$op=(string)($_GET['op']??'');
if(!in_array($op,['list','dossier','dossier_import','upload','preview','save','word','pdf','report','finalize'],true)) reject(400,'Operazione non valida');
if((int)($_SERVER['CONTENT_LENGTH']??0)>28000000) reject(413,'Richiesta troppo grande');
$body=file_get_contents('php://input',false,null,0,28000001);
if(strlen($body)>28000000) reject(413,'Richiesta troppo grande');
$dataDir=\OC::$server->getConfig()->getSystemValue('datadirectory','/var/www/html/data');
$key=@file_get_contents($dataDir.'/studio-cessioni/service.key');
if(!$key) reject(503,'Servizio cessioni non configurato');
$ch=curl_init('http://cessioni:8096/'.$op);
curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>240,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Service-Key: '.trim($key),'X-Studio-User: '.$uid]]);
$response=curl_exec($ch);
if($response===false) reject(503,'Servizio documenti non disponibile. La pratica rimane in bozza.');
http_response_code((int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE));
curl_close($ch);
echo $response;
