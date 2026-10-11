<?php
declare(strict_types=1);
function loc_demand(bool $ok,string $message): void { if(!$ok) throw new DomainException($message); }
function loc_date(mixed $v): bool { if(!is_string($v))return false; $d=DateTimeImmutable::createFromFormat('!Y-m-d',$v);return $d!==false&&$d->format('Y-m-d')===$v; }
function loc_text(array $r,string $k,int $max=300,bool $required=false): string { $v=$r[$k]??'';loc_demand(is_string($v)&&strlen($v)<=$max,"Campo non valido: $k");$v=trim($v);loc_demand(!$required||$v!=='',"Campo obbligatorio: $k");return $v; }
function loc_id(mixed $id): bool { return is_string($id)&&preg_match('/^[a-zA-Z0-9_-]{8,80}$/D',$id)===1; }
function loc_empty(): array { return ['schemaVersion'=>1,'properties'=>[],'contracts'=>[],'payments'=>[],'reminders'=>[]]; }
function loc_preserve_history(array $old,array $next): void {
 $before=array_column($old['contracts'],null,'id');$after=array_column($next['contracts'],null,'id');
 foreach($old['payments'] as $p){$id=$p['contractId'];loc_demand(isset($after[$id]),'Conservare i contratti con incassi');foreach(['start','end','frequency','dueDay','rentCents'] as $key)loc_demand($before[$id][$key]===$after[$id][$key],'Il piano rate con incassi registrati non puo essere modificato');}
}
function loc_rows(array $s,string $key): array { $v=$s[$key]??null;loc_demand(is_array($v)&&array_is_list($v)&&count($v)<=3000,"Elenco non valido: $key");$ids=[];foreach($v as $r){loc_demand(is_array($r)&&loc_id($r['id']??null),"Identificativo non valido: $key");loc_demand(!isset($ids[$r['id']]),"Identificativo duplicato: $key");$ids[$r['id']]=true;}return $v; }
function loc_validate(array $s): array {
 loc_demand(($s['schemaVersion']??null)===1,'Versione archivio non supportata');$out=loc_empty();$properties=[];$contracts=[];
 foreach(loc_rows($s,'properties') as $p){$r=['id'=>$p['id']];foreach(['name','address','owner','cadastral','notes'] as $k)$r[$k]=loc_text($p,$k,$k==='notes'?3000:500,in_array($k,['name','address','owner'],true));$properties[$r['id']]=$r;$out['properties'][]=$r;}
 foreach(loc_rows($s,'contracts') as $c){
  loc_demand(isset($properties[$c['propertyId']??'']),'Immobile non trovato');
  loc_demand(loc_date($c['start']??null)&&loc_date($c['end']??null)&&$c['start']<=$c['end'],'Date contratto non valide');
  loc_demand((int)substr($c['start'],0,4)>=1900&&(int)substr($c['end'],0,4)<=(int)substr($c['start'],0,4)+49,'Durata massima gestita: 49 anni');
  loc_demand(in_array($c['frequency']??null,[1,3,6,12],true),'Periodicita non valida');
  loc_demand(is_int($c['dueDay']??null)&&$c['dueDay']>=1&&$c['dueDay']<=31,'Giorno scadenza non valido');
  foreach(['rentCents','depositCents'] as $k)loc_demand(is_int($c[$k]??null)&&$c[$k]>=($k==='rentCents'?1:0)&&$c[$k]<=9999999999,'Importo non valido');
  $r=['id'=>$c['id'],'propertyId'=>$c['propertyId'],'start'=>$c['start'],'end'=>$c['end'],'frequency'=>$c['frequency'],'dueDay'=>$c['dueDay'],'rentCents'=>$c['rentCents'],'depositCents'=>$c['depositCents'],'archived'=>(bool)($c['archived']??false)];
  foreach(['name','tenant','tenantCode','type','registration','notes'] as $k)$r[$k]=loc_text($c,$k,$k==='notes'?3000:500,in_array($k,['name','tenant'],true));
  $contracts[$r['id']]=$r;$out['contracts'][]=$r;
 }
 $sums=[];
 foreach(loc_rows($s,'payments') as $p){
  $c=$contracts[$p['contractId']??'']??null;loc_demand($c!==null,'Contratto incasso non trovato');
  $key=loc_text($p,'installmentKey',100,true);$prefix=$c['id'].':';$period=substr($key,strlen($prefix));
  loc_demand(str_starts_with($key,$prefix)&&preg_match('/^\d{4}-\d{2}$/D',$period)===1&&loc_date($period.'-01'),'Rata non valida');
  $month=((int)substr($period,0,4)-(int)substr($c['start'],0,4))*12+(int)substr($period,5,2)-(int)substr($c['start'],5,2);
  $first=new DateTimeImmutable($period.'-01');$day=min($c['dueDay'],(int)$first->format('t'));$due=max($c['start'],$period.'-'.str_pad((string)$day,2,'0',STR_PAD_LEFT));
  loc_demand($month>=0&&$month%$c['frequency']===0&&$due<=$c['end'],'Rata fuori dal contratto');
  loc_demand(loc_date($p['date']??null)&&$p['date']<=date('Y-m-d'),'Data incasso non valida o futura');
  loc_demand(is_int($p['amountCents']??null)&&$p['amountCents']>0&&$p['amountCents']<=$c['rentCents'],'Importo incasso non valido');
  $r=['id'=>$p['id'],'contractId'=>$c['id'],'installmentKey'=>$key,'date'=>$p['date'],'amountCents'=>$p['amountCents'],'reference'=>loc_text($p,'reference',500),'voided'=>(bool)($p['voided']??false)];
  if(!$r['voided']){$sums[$key]=($sums[$key]??0)+$r['amountCents'];loc_demand($sums[$key]<=$c['rentCents'],'Gli incassi superano la rata');}$out['payments'][]=$r;
 }
 foreach(loc_rows($s,'reminders') as $p){loc_demand(isset($contracts[$p['contractId']??'']),'Contratto promemoria non trovato');loc_demand(loc_date($p['date']??null),'Data promemoria non valida');$out['reminders'][]=['id'=>$p['id'],'contractId'=>$p['contractId'],'date'=>$p['date'],'title'=>loc_text($p,'title',500,true),'notes'=>loc_text($p,'notes',3000),'done'=>(bool)($p['done']??false)];}
 return $out;
}
