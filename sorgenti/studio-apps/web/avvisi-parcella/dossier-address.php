<?php
declare(strict_types=1);
function dossierAddress(string $dataRoot,string $clientId): array {
    $pipes=[];
    $process=proc_open(['python3',__DIR__.'/dossier_address.py',$dataRoot,$clientId],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    if(!is_resource($process))return ['status'=>'missing','message'=>'Recupero indirizzo non disponibile.'];
    fclose($pipes[0]);stream_set_blocking($pipes[1],false);stream_set_blocking($pipes[2],false);
    $output='';$started=microtime(true);
    do {
        $output.=stream_get_contents($pipes[1]);stream_get_contents($pipes[2]);
        $running=proc_get_status($process)['running'];
        if(!$running)break;
        if(microtime(true)-$started>20){proc_terminate($process);break;}
        usleep(20000);
    }while(true);
    $output.=stream_get_contents($pipes[1]);fclose($pipes[1]);fclose($pipes[2]);proc_close($process);
    $result=json_decode($output,true);
    return is_array($result)?$result:['status'=>'missing','message'=>'Indirizzo non recuperato automaticamente. Verificare nel Dossier.'];
}
