<?php
declare(strict_types=1);

function referencePeriod(array $p,bool $required=false): ?array {
    if(!$required && empty($p['periodEnabled']))return null;
    $year=filter_var($p['periodYear']??null,FILTER_VALIDATE_INT);
    demand($year!==false && $year>=2000 && $year<=2099,'Anno di riferimento non valido');
    $quarters=$p['periodQuarters']??[$p['periodQuarter']??null];
    demand(is_array($quarters)&&count($quarters)>0&&count($quarters)<=4,'Selezionare almeno un trimestre');
    $quarters=array_map(function($v){$q=filter_var($v,FILTER_VALIDATE_INT);demand($q!==false&&$q>=1&&$q<=4,'Selezionare trimestri da 1 a 4');return $q;},$quarters);
    $quarters=array_values(array_unique($quarters));sort($quarters);$ranges=[];$keys=[];
    foreach($quarters as $quarter){
        $start=sprintf('%04d-%02d-01',$year,($quarter-1)*3+1);
        $end=(new DateTimeImmutable($start))->modify('+3 months -1 day')->format('Y-m-d');
        $ranges[]=['start'=>$start,'end'=>$end];$keys[]=$year.'-Q'.$quarter;
    }
    return ['year'=>$year,'quarter'=>$quarters[0],'quarters'=>$quarters,'keys'=>$keys,'key'=>implode('+',$keys),
        'label'=>implode(' e ',array_map(fn($q)=>$q.'°',$quarters)).' trimestre '.$year,
        'start'=>$ranges[0]['start'],'end'=>$ranges[count($ranges)-1]['end'],'ranges'=>$ranges];
}

function periodKeys(?array $period): array {return $period?($period['keys']??[$period['key']]):[];}

function quarterlyPlan(array $s,array $p): array {
    $period=referencePeriod($p,true);
    $date=day((string)($p['date']??''));
    $description=textval($p['serviceDescription']??'',200);
    $ids=$p['clientIds']??[];
    demand(is_array($ids)&&count($ids)>0&&count($ids)<=500,'Selezionare almeno un cliente (massimo 500)');
    demand(count(array_filter($ids,'is_string'))===count($ids),'Selezione clienti non valida');
    $ids=array_values(array_unique($ids));
    $rows=[];$skipped=[];
    foreach($ids as $id){
        demand(isset($s['clients'][$id]),'Cliente non trovato: aggiornare l’elenco');
        $c=$s['clients'][$id];demand(!empty($c['active']),'La selezione comprende un accordo sospeso');
        $existing=null;
        foreach($s['notices'] as $n){
            if($n['clientId']===$id && !$n['cancelled'] && array_intersect(periodKeys($n['period']??null),$period['keys'])){$existing=$n;break;}
        }
        if($existing){$skipped[]=['clientId'=>$id,'name'=>$c['name'],'number'=>$existing['number']];continue;}
        $ls=lines($c['lines']);
        foreach($ls as &$line)if($line['basis']==='quarter')$line['quantity']=count($period['quarters']);unset($line);
        $r=rates($c);
        $next=$c['nextDate'];
        if(!empty($p['advanceSchedule']) && $c['months']===3){
            $steps=0;
            while($next<=$date){demand(++$steps<=500,'Prossima data troppo lontana nel passato: correggere l’accordo');$next=nextDate($next,3,$c['anchor']);}
        }
        $rows[]=['clientId'=>$id,'name'=>$c['name'],'lines'=>$ls,'rates'=>$r,'totals'=>totals($ls,$r),
            'due'=>$date,
            'previousNextDate'=>$c['nextDate'],'nextDate'=>$next,'months'=>$c['months']];
    }
    return ['period'=>$period,'date'=>$date,'serviceDescription'=>$description,'rows'=>$rows,'skipped'=>$skipped,
        'net'=>array_sum(array_column(array_column($rows,'totals'),'net'))];
}

function generateQuarterly(array &$s,array $p,string $actor): array {
    // Validate the whole selection before allocating document numbers or changing schedules.
    $plan=quarterlyPlan($s,$p);
    demand(count($plan['rows'])>0,'Tutti i clienti selezionati hanno già un avviso per questo trimestre');
    $created=[];
    foreach($plan['rows'] as $row){
        $id=mutate($s,'notice',$row['rates']+['clientId'=>$row['clientId'],'date'=>$plan['date'],'due'=>$row['due'],
            'lines'=>$row['lines'],'periodEnabled'=>true,'periodYear'=>$plan['period']['year'],'periodQuarters'=>$plan['period']['quarters'],
            'serviceDescription'=>$plan['serviceDescription'],'recurrenceKey'=>$row['clientId'].':'.$plan['period']['key']],$actor);
        $s['clients'][$row['clientId']]['nextDate']=$row['nextDate'];$created[]=$id;
    }
    return ['created'=>$created,'skipped'=>count($plan['skipped']),'period'=>$plan['period']['label']];
}
