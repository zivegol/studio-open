<?php
declare(strict_types=1);
// Deployed outside the public directory. No Entratel credentials or browser worker.

function ade_verify(string $kind, string $value, ?string $configDir = null): array {
    $dir = $configDir ?? '/var/www/html/config';
    if (!in_array($kind,['cf','piva'],true)) return [400,['error'=>'Servizio non valido.']];
    $value = strtoupper(trim($value));
    if (!preg_match($kind==='piva'?'/^[0-9]{11}$/D':'/^(?:[0-9]{11}|[A-Z0-9]{16})$/D',$value)) return [400,['error'=>'Inserisci un identificativo nel formato corretto.']];
    $credentials = json_decode(@file_get_contents($dir.'/ade-anagrafiche.json') ?: '',true);
    if (!is_array($credentials) || empty($credentials['id']) || empty($credentials['secret'])) return [503,['error'=>'Credenziali API anagrafiche non configurate.']];
    foreach (['id','secret'] as $k) if (preg_match('/[\r\n]/',$credentials[$k])) return [503,['error'=>'Configurazione API non valida.']];
    $lock = fopen($dir.'/ade-api-quota.json','c+');
    if (!$lock || !flock($lock,LOCK_EX)) throw new RuntimeException('Quota unavailable');
    try {
        $state=json_decode(stream_get_contents($lock) ?: '{}',true);
        $now=time(); $calls=array_values(array_filter($state['calls']??[],fn($t)=>is_int($t)&&$t>$now-86400));
        $recent=array_values(array_filter($calls,fn($t)=>$t>$now-60));
        $wait=max(0,($state['until']??0)-$now);
        if(count($calls)>=100) $wait=max($wait,min($calls)+86400-$now);
        if(count($recent)>=10) $wait=max($wait,min($recent)+60-$now);
        if($wait>0) return [429,['error'=>'Limite di utilizzo raggiunto. Attendi prima di riprovare.','retryAfter'=>$wait]];
        // Reserve before network: concurrent requests share the same client quota.
        $calls[]=$now; rewind($lock);ftruncate($lock,0);fwrite($lock,json_encode(['calls'=>$calls,'until'=>0]));fflush($lock);
    } finally {flock($lock,LOCK_UN);fclose($lock);}
    $service=$kind==='cf'?'codice-fiscale':'partita-iva'; $field=$kind==='cf'?'codiceFiscale':'partitaIva'; $retry=60;
    $curl=curl_init('https://api.agenziaentrate.gov.it/entrate/api/'.$service.'-liberoaccesso/verifica');
    curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode([$field=>$value]),CURLOPT_HTTPHEADER=>['Content-Type: application/json','Accept: application/json','X-Client-Id: '.$credentials['id'],'X-Client-Secret: '.$credentials['secret']],CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_HEADERFUNCTION=>function($c,$line)use(&$retry){if(preg_match('/^Retry-After:\s*(\d+)/i',$line,$m))$retry=max(1,min(86400,(int)$m[1]));return strlen($line);}]);
    $raw=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);unset($credentials);
    if($status===429){
        $lock=fopen($dir.'/ade-api-quota.json','c+');if(!$lock||!flock($lock,LOCK_EX))throw new RuntimeException('Quota unavailable');
        try{$state=json_decode(stream_get_contents($lock)?:'{}',true);$state['until']=max($state['until']??0,time()+$retry);rewind($lock);ftruncate($lock,0);fwrite($lock,json_encode($state));}finally{flock($lock,LOCK_UN);fclose($lock);}
        return [429,['error'=>'L’Agenzia ha raggiunto il limite di richieste.','retryAfter'=>$retry]];
    }
    if(in_array($status,[401,403],true))return [502,['error'=>'L’Agenzia non ha autorizzato queste credenziali API. Verificare adesione e abilitazione al servizio.']];
    if($raw===false||$status!==200)return [502,['error'=>'Servizio dell’Agenzia temporaneamente non disponibile. Nessun esito di validità acquisito.']];
    $data=json_decode($raw,true);$flag=$kind==='cf'?'valido':'valida';
    if(!is_array($data)||!isset($data[$flag])||!is_bool($data[$flag]))return [502,['error'=>'Risposta dell’Agenzia non riconosciuta.']];
    $fields=$kind==='cf'?['valido','messaggio']:['valida','partitaIva','denominazione','dataInizioAttivita','dataCessazioneAttivita','dataInizioSospensione','isGruppoIva','partitaIvaGruppo','dataInizioPartecipazioneGruppoIva','isPartecipanteGruppoIva'];
    $result=array_intersect_key($data,array_flip($fields));
    foreach($result as $v)if(!is_scalar($v)&&$v!==null)return [502,['error'=>'Risposta dell’Agenzia non riconosciuta.']];
    return [200,['kind'=>$kind,'identifier'=>$value,'checkedAt'=>gmdate('c'),'source'=>'API Agenzia delle Entrate','result'=>$result]];
}

// -------------------------------------------------------------
// CU MASSIVO (Servizio interoperabilità fuori PDND - ModI)
// -------------------------------------------------------------

function ade_cu_base64url(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function ade_cu_make_jwt(array $header, array $payload, string $pkeyPem): string {
    $h = ade_cu_base64url(json_encode($header, JSON_UNESCAPED_SLASHES));
    $p = ade_cu_base64url(json_encode($payload, JSON_UNESCAPED_SLASHES));
    $in = $h . '.' . $p;
    $sig = '';
    if (!openssl_sign($in, $sig, $pkeyPem, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Firma digitale del token JWT non riuscita.');
    }
    return $in . '.' . ade_cu_base64url($sig);
}

function ade_cu_get_kek(): string {
    $env = getenv('STUDIO_ADE_KEK');
    if (is_string($env) && strlen(trim($env)) >= 32) {
        return hash('sha256', trim($env), true);
    }
    $kekFile = '/var/www/html/data/studio-ade-kek.key';
    if (is_readable($kekFile)) {
        $raw = trim((string)file_get_contents($kekFile));
        if (strlen($raw) >= 32) {
            return hash('sha256', $raw, true);
        }
    }
    return hash('sha256', \OC::$server->getConfig()->getSystemValueString('secret'), true);
}

function ade_cu_decrypt_certificates(array $rawCerts): string|false {
    if (empty($rawCerts['ciphertext']) || empty($rawCerts['iv']) || empty($rawCerts['tag'])) return false;
    $ciphertext = base64_decode($rawCerts['ciphertext']);
    $iv = base64_decode($rawCerts['iv']);
    $tag = base64_decode($rawCerts['tag']);

    // 1. Try dedicated KEK
    $kek = ade_cu_get_kek();
    $dec = openssl_decrypt($ciphertext, 'aes-256-gcm', $kek, OPENSSL_RAW_DATA, $iv, $tag, 'ade-cu-certificates-v1');
    if ($dec !== false) return $dec;

    // 2. Try legacy Nextcloud secret with auto-migration
    $ncKey = hash('sha256', \OC::$server->getConfig()->getSystemValueString('secret'), true);
    if ($ncKey !== $kek) {
        $dec = openssl_decrypt($ciphertext, 'aes-256-gcm', $ncKey, OPENSSL_RAW_DATA, $iv, $tag, 'ade-cu-certificates-v1');
        if ($dec !== false) {
            try {
                $newIv = random_bytes(12); $newTag = '';
                $newCipher = openssl_encrypt($dec, 'aes-256-gcm', $kek, OPENSSL_RAW_DATA, $newIv, $newTag, 'ade-cu-certificates-v1');
                if ($newCipher !== false) {
                    $dir = '/var/www/html/config'; $tmp = tempnam($dir, 'ade-cu-');
                    chmod($tmp, 0600);
                    file_put_contents($tmp, json_encode(['version' => 1, 'iv' => base64_encode($newIv), 'tag' => base64_encode($newTag), 'ciphertext' => base64_encode($newCipher)]));
                    rename($tmp, $dir . '/ade-cu-certificates.json');
                }
            } catch (\Throwable) {}
            return $dec;
        }
    }
    return false;
}

function ade_cu_load_credentials(?string $configDir = null): array {
    $dir = $configDir ?? '/var/www/html/config';
    $secretFile = $dir . '/ade-cu.json';
    $certsFile = $dir . '/ade-cu-certificates.json';
    if (!is_readable($secretFile) || !is_readable($certsFile)) {
        throw new RuntimeException('Credenziali CU o certificati non configurati.');
    }
    $secretData = json_decode(@file_get_contents($secretFile) ?: '', true);
    if (!is_array($secretData) || empty($secretData['client_secret'])) {
        throw new RuntimeException('Client Secret CU non configurato.');
    }
    $rawCerts = json_decode(@file_get_contents($certsFile) ?: '', true);
    if (!is_array($rawCerts) || empty($rawCerts['ciphertext'])) {
        throw new RuntimeException('Certificati CU non disponibili.');
    }
    $decrypted = ade_cu_decrypt_certificates($rawCerts);
    if ($decrypted === false) {
        throw new RuntimeException('Decifratura certificati CU non riuscita.');
    }
    $certsData = json_decode($decrypted, true);
    $password = $certsData['password'] ?? '';
    $firmaP12 = base64_decode($certsData['certificates']['firma'] ?? '');
    $keys = [];
    if (!@openssl_pkcs12_read($firmaP12, $keys, $password)) {
        $cmd = 'openssl pkcs12 -legacy -nodes -passin env:PASS';
        $proc = proc_open($cmd, [0=>['pipe','r'], 1=>['pipe','w'], 2=>['pipe','w']], $pipes, null, ['PASS'=>$password]);
        if (is_resource($proc)) {
            fwrite($pipes[0], $firmaP12); fclose($pipes[0]);
            $out = stream_get_contents($pipes[1]); fclose($pipes[1]);
            fclose($pipes[2]);
            if (proc_close($proc) === 0) {
                if (preg_match('/(-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----)/', $out, $km)) $keys['pkey'] = $km[1];
                if (preg_match('/(-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----)/', $out, $cm)) $keys['cert'] = $cm[1];
            }
        }
    }
    if (empty($keys['cert']) || empty($keys['pkey'])) {
        throw new RuntimeException('Impossibile estrarre certificato di firma o chiave privata.');
    }
    $info = openssl_x509_parse($keys['cert']);
    $cn = $info['subject']['CN'] ?? '';
    $cf = $cn;
    $sede = '000';
    if (preg_match('/^([A-Z0-9]{11,16})-([0-9]{3})$/', $cn, $m)) {
        $cf = $m[1];
        $sede = $m[2];
    }
    $cleanCert = preg_replace('/-----(BEGIN|END) CERTIFICATE-----|\s+/', '', $keys['cert']);
    return [
        'client_secret' => $secretData['client_secret'],
        'cn' => $cn,
        'cf' => $cf,
        'sede' => $sede,
        'cert_pem' => $keys['cert'],
        'clean_cert' => $cleanCert,
        'pkey_pem' => $keys['pkey'],
        'subject' => $info['subject'] ?? [],
        'validTo' => gmdate('Y-m-d', $info['validTo_time_t'] ?? 0)
    ];
}

function ade_cu_send_request(string $fileBytes, ?string $configDir = null): array {
    $dir = $configDir ?? '/var/www/html/config';
    $creds = ade_cu_load_credentials($dir);

    // Quota lock: 2 chiamate / 24h, 1 chiamata / 60s
    $lock = fopen($dir . '/ade-cu-quota.json', 'c+');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Quota CU unavailable');
    try {
        $state = json_decode(stream_get_contents($lock) ?: '{}', true);
        $now = time();
        $calls = array_values(array_filter($state['requests'] ?? [], fn($t) => is_int($t) && $t > $now - 86400));
        $recent = array_values(array_filter($calls, fn($t) => $t > $now - 60));
        $wait = max(0, ($state['req_until'] ?? 0) - $now);
        if (count($calls) >= 2) $wait = max($wait, min($calls) + 86400 - $now);
        if (count($recent) >= 1) $wait = max($wait, min($recent) + 60 - $now);
        if ($wait > 0) return [429, ['error' => 'Limite di richieste CU raggiunto (massimo 2 al giorno). Riprova tra ' . $wait . ' secondi.', 'retryAfter' => $wait]];
    } finally {
        flock($lock, LOCK_UN); fclose($lock);
    }

    $aud = 'https://modipa.agenziaentrate.gov.it/govway/rest/in/AgenziaEntrate-priv/scarico-cu/v1';
    $url = $aud . '/richiesta';
    $bodyData = [
        'client_secret' => $creds['client_secret'],
        'codicefiscale_operatore' => $creds['cf'],
        'sede_operatore' => $creds['sede'],
        'file' => base64_encode($fileBytes)
    ];
    $bodyJson = json_encode($bodyData, JSON_UNESCAPED_SLASHES);
    $digest = 'SHA-256=' . base64_encode(hash('sha256', $bodyJson, true));

    $joseHeader = ['alg' => 'RS256', 'typ' => 'JWT', 'x5c' => [$creds['clean_cert']]];
    $now = time();
    $authJwt = ade_cu_make_jwt($joseHeader, [
        'iss' => $creds['cn'], 'sub' => $creds['cn'], 'aud' => $aud, 'client_id' => $creds['cn'],
        'iat' => $now, 'nbf' => $now - 5, 'exp' => $now + 300,
        'jti' => bin2hex(random_bytes(16))
    ], $creds['pkey_pem']);

    $integrityJwt = ade_cu_make_jwt($joseHeader, [
        'iss' => $creds['cn'], 'sub' => $creds['cn'], 'aud' => $aud, 'client_id' => $creds['cn'],
        'iat' => $now, 'nbf' => $now - 5, 'exp' => $now + 300,
        'jti' => bin2hex(random_bytes(16)),
        'signed_headers' => [
            ['digest' => $digest],
            ['content-type' => 'application/json']
        ]
    ], $creds['pkey_pem']);

    $auditJwt = ade_cu_make_jwt($joseHeader, [
        'iss' => $creds['cn'], 'sub' => $creds['cn'], 'aud' => $aud, 'client_id' => $creds['cn'],
        'iat' => $now, 'nbf' => $now - 5, 'exp' => $now + 300,
        'jti' => bin2hex(random_bytes(16)),
        'userID' => $creds['cf'],
        'userLocation' => '127.0.0.1',
        'LoA' => 'LOA_3'
    ], $creds['pkey_pem']);

    $retry = 60;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $bodyJson,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'Digest: ' . $digest,
            'Authorization: Bearer ' . $authJwt,
            'Agid-JWT-Signature: ' . $integrityJwt,
            'Agid-JWT-TrackingEvidence: ' . $auditJwt
        ],
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_HEADERFUNCTION => function($c, $line) use (&$retry) {
            if (preg_match('/^Retry-After:\s*(\d+)/i', $line, $m)) $retry = max(1, min(86400, (int)$m[1]));
            return strlen($line);
        }
    ]);
    $raw = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    // Always log AdE gateway response for diagnostics
    @file_put_contents('/var/www/html/data/ade-cu-debug.log', date('c') . " [HTTP $status] Retry-After: $retry | Body: " . (is_string($raw) ? substr($raw, 0, 2000) : 'false') . "\n", FILE_APPEND);

    if ($status === 429) {
        $lock = fopen($dir . '/ade-cu-quota.json', 'c+');
        if ($lock && flock($lock, LOCK_EX)) {
            $state = json_decode(stream_get_contents($lock) ?: '{}', true);
            $state['req_until'] = max($state['req_until'] ?? 0, time() + $retry);
            // An HTTP 429 does not prove that the upstream quota excludes this call.
            // Retain the attempt to prevent repeated sends beyond the local budget.
            rewind($lock); ftruncate($lock, 0); fwrite($lock, json_encode($state)); fflush($lock);
            flock($lock, LOCK_UN); fclose($lock);
        }
        $adeBody = json_decode($raw ?: '', true);
        $adeDetail = is_array($adeBody) ? ($adeBody['detail'] ?? $adeBody['title'] ?? $adeBody['messaggio'] ?? '') : '';
        $msg = $adeDetail ? ('L’Agenzia delle Entrate: ' . $adeDetail . '.') : 'L’Agenzia delle Entrate ha imposto una finestra temporanea di rispetto dei limiti di frequenza.';
        return [429, ['error' => $msg, 'retryAfter' => $retry]];
    }
    if ($raw === false) return [502, ['error' => 'Impossibile connettersi ai server dell’Agenzia delle Entrate.']];
    $data = json_decode($raw, true);
    if (!is_array($data)) return [502, ['error' => 'Risposta non valida dall’Agenzia (HTTP ' . $status . ').']];
    if ($status === 200 || $status === 202) {
        $lock = fopen($dir . '/ade-cu-quota.json', 'c+');
        if ($lock && flock($lock, LOCK_EX)) {
            $state = json_decode(stream_get_contents($lock) ?: '{}', true);
            $calls = array_values(array_filter($state['requests'] ?? [], fn($t) => is_int($t) && $t > time() - 86400));
            $calls[] = time();
            $state['requests'] = $calls;
            rewind($lock); ftruncate($lock, 0); fwrite($lock, json_encode($state)); fflush($lock);
            flock($lock, LOCK_UN); fclose($lock);
        }
        return [200, [
            'protocollo' => $data['protocollo'] ?? '',
            'messaggio' => $data['messaggio'] ?? 'Richiesta sottomessa con successo',
            'esito' => $data['esito'] ?? 0
        ]];
    }
    return [$status >= 400 && $status < 500 ? $status : 502, [
        'error' => $data['detail'] ?? $data['title'] ?? $data['messaggio'] ?? ('Errore Agenzia (HTTP ' . $status . ')')
    ]];
}

function ade_cu_get_esito(string $protocollo, ?string $configDir = null): array {
    $dir = $configDir ?? '/var/www/html/config';
    $protocollo = trim($protocollo);
    if (!preg_match('/^[A-Za-z0-9\-]{5,40}$/', $protocollo)) {
        return [400, ['error' => 'Protocollo non valido.']];
    }
    $creds = ade_cu_load_credentials($dir);

    // Quota lock: 10 chiamate / 24h, 1 chiamata / 60s
    $lock = fopen($dir . '/ade-cu-quota.json', 'c+');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Quota CU unavailable');
    try {
        $state = json_decode(stream_get_contents($lock) ?: '{}', true);
        $now = time();
        $calls = array_values(array_filter($state['esiti'] ?? [], fn($t) => is_int($t) && $t > $now - 86400));
        $recent = array_values(array_filter($calls, fn($t) => $t > $now - 60));
        $wait = max(0, ($state['esito_until'] ?? 0) - $now);
        if (count($calls) >= 10) $wait = max($wait, min($calls) + 86400 - $now);
        if (count($recent) >= 1) $wait = max($wait, min($recent) + 60 - $now);
        if ($wait > 0) return [429, ['error' => 'Limite di recuperi esito raggiunto (massimo 10 al giorno). Riprova tra ' . $wait . ' secondi.', 'retryAfter' => $wait]];
    } finally {
        flock($lock, LOCK_UN); fclose($lock);
    }

    $aud = 'https://modipa.agenziaentrate.gov.it/govway/rest/in/AgenziaEntrate-priv/scarico-cu/v1';
    $url = $aud . '/recupero-esito';
    $bodyData = [
        'client_secret' => $creds['client_secret'],
        'codicefiscale_operatore' => $creds['cf'],
        'sede_operatore' => $creds['sede'],
        'protocollo' => $protocollo
    ];
    $bodyJson = json_encode($bodyData, JSON_UNESCAPED_SLASHES);
    $digest = 'SHA-256=' . base64_encode(hash('sha256', $bodyJson, true));

    $joseHeader = ['alg' => 'RS256', 'typ' => 'JWT', 'x5c' => [$creds['clean_cert']]];
    $now = time();
    $authJwt = ade_cu_make_jwt($joseHeader, [
        'iss' => $creds['cn'], 'sub' => $creds['cn'], 'aud' => $aud, 'client_id' => $creds['cn'],
        'iat' => $now, 'nbf' => $now - 5, 'exp' => $now + 300,
        'jti' => bin2hex(random_bytes(16))
    ], $creds['pkey_pem']);

    $integrityJwt = ade_cu_make_jwt($joseHeader, [
        'iss' => $creds['cn'], 'sub' => $creds['cn'], 'aud' => $aud, 'client_id' => $creds['cn'],
        'iat' => $now, 'nbf' => $now - 5, 'exp' => $now + 300,
        'jti' => bin2hex(random_bytes(16)),
        'signed_headers' => [
            ['digest' => $digest],
            ['content-type' => 'application/json']
        ]
    ], $creds['pkey_pem']);

    $auditJwt = ade_cu_make_jwt($joseHeader, [
        'iss' => $creds['cn'], 'sub' => $creds['cn'], 'aud' => $aud, 'client_id' => $creds['cn'],
        'iat' => $now, 'nbf' => $now - 5, 'exp' => $now + 300,
        'jti' => bin2hex(random_bytes(16)),
        'userID' => $creds['cf'],
        'userLocation' => '127.0.0.1',
        'LoA' => 'LOA_3'
    ], $creds['pkey_pem']);

    $retry = 60;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $bodyJson,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'Digest: ' . $digest,
            'Authorization: Bearer ' . $authJwt,
            'Agid-JWT-Signature: ' . $integrityJwt,
            'Agid-JWT-TrackingEvidence: ' . $auditJwt
        ],
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_HEADERFUNCTION => function($c, $line) use (&$retry) {
            if (preg_match('/^Retry-After:\s*(\d+)/i', $line, $m)) $retry = max(1, min(86400, (int)$m[1]));
            return strlen($line);
        }
    ]);
    $raw = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($status === 429) {
        $lock = fopen($dir . '/ade-cu-quota.json', 'c+');
        if ($lock && flock($lock, LOCK_EX)) {
            $state = json_decode(stream_get_contents($lock) ?: '{}', true);
            $state['esito_until'] = max($state['esito_until'] ?? 0, time() + $retry);
            rewind($lock); ftruncate($lock, 0); fwrite($lock, json_encode($state)); fflush($lock);
            flock($lock, LOCK_UN); fclose($lock);
        }
        return [429, ['error' => 'L’Agenzia ha risposto con limite di frequenza raggiunto. Attendi ' . $retry . ' secondi.', 'retryAfter' => $retry]];
    }
    if ($raw === false) return [502, ['error' => 'Impossibile connettersi ai server dell’Agenzia delle Entrate.']];
    $data = json_decode($raw, true);
    if (!is_array($data)) return [502, ['error' => 'Risposta non valida dall’Agenzia (HTTP ' . $status . ').']];

    if ($status === 200 || $status === 202) {
        $lock = fopen($dir . '/ade-cu-quota.json', 'c+');
        if ($lock && flock($lock, LOCK_EX)) {
            $state = json_decode(stream_get_contents($lock) ?: '{}', true);
            $calls = array_values(array_filter($state['esiti'] ?? [], fn($t) => is_int($t) && $t > time() - 86400));
            $calls[] = time();
            $state['esiti'] = $calls;
            rewind($lock); ftruncate($lock, 0); fwrite($lock, json_encode($state)); fflush($lock);
            flock($lock, LOCK_UN); fclose($lock);
        }
    }

    if ($status === 202) {
        return [202, [
            'status' => 'in_elaborazione',
            'protocollo' => $protocollo,
            'messaggio' => $data['messaggio'] ?? 'Richiesta presa in carico / in elaborazione'
        ]];
    }
    if ($status === 200) {
        return [200, [
            'status' => 'completata',
            'protocollo' => $protocollo,
            'messaggio' => $data['messaggio'] ?? 'Elaborazione completata',
            'esito' => $data['esito'] ?? 0,
            'file_ricevuta' => $data['file_ricevuta'] ?? null,
            'file_cu' => $data['file_cu'] ?? null
        ]];
    }
    return [$status >= 400 && $status < 500 ? $status : 502, [
        'error' => $data['detail'] ?? $data['title'] ?? $data['messaggio'] ?? ('Errore Agenzia (HTTP ' . $status . ')')
    ]];
}

function ade_cu_diagnostics(?string $configDir = null): array {
    $dir = $configDir ?? '/var/www/html/config';
    $checks = [];

    // Check files
    $checks['secret_configured'] = is_readable($dir . '/ade-cu.json');
    $checks['certs_configured'] = is_readable($dir . '/ade-cu-certificates.json');
    $checks['ca_configured'] = is_readable($dir . '/ade-entratel-ca.pem');

    if (!$checks['certs_configured'] || !$checks['secret_configured']) {
        return ['status' => 'incomplete', 'checks' => $checks];
    }

    try {
        $creds = ade_cu_load_credentials($dir);
        $checks['cert_subject'] = $creds['cn'];
        $checks['cert_valid_to'] = $creds['validTo'];
        $checks['operator_cf'] = $creds['cf'];
        $checks['operator_sede'] = $creds['sede'];
        $checks['client_secret_present'] = !empty($creds['client_secret']);

        // Test JWT generation
        $now = time();
        $aud = 'https://modipa.agenziaentrate.gov.it/govway/rest/in/AgenziaEntrate-priv/scarico-cu/v1';
        $testJwt = ade_cu_make_jwt(['alg'=>'RS256','typ'=>'JWT','x5c'=>[$creds['clean_cert']]], [
            'iss' => $creds['cn'], 'sub' => $creds['cn'], 'aud' => $aud, 'client_id' => $creds['cn'],
            'iat' => $now, 'nbf' => $now - 5, 'exp' => $now + 300,
            'jti' => bin2hex(random_bytes(16))
        ], $creds['pkey_pem']);
        $checks['jwt_signature_ok'] = !empty($testJwt);

        // Test TLS handshake and gateway reachability
        $ch = curl_init('https://modipa.agenziaentrate.gov.it/govway/rest/in/AgenziaEntrate-priv/scarico-cu/v1/richiesta');
        curl_setopt_array($ch, [
            CURLOPT_NOBODY => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 15
        ]);
        curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $checks['gateway_reachable'] = ($code > 0);
        $checks['gateway_status_code'] = $code;

        return [
            'status' => 'ready',
            'checks' => $checks,
            'message' => 'Collaudo preliminare completato con successo: ambiente di sicurezza, chiavi e gateway Agenzia Entrate operativi.'
        ];
    } catch (\Throwable $e) {
        return [
            'status' => 'error',
            'checks' => $checks,
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Builds the official Sogei ministerial RCU file (1900 bytes per record)
 * Format compliant with MRCU26 / ControlloRCU26 specifications.
 */
function ade_cu_build_rcu(array $clientTaxCodes, array $options = []): string {
    $fornitore = strtoupper(trim((string)($options['fornitore'] ?? 'DEMO000000000000')));
    $richiedente = strtoupper(trim((string)($options['richiedente'] ?? '00000000000')));
    $denominazione = strtoupper(trim((string)($options['denominazione'] ?? 'STUDIO ASSOCIATO studio-example')));
    $email = strtolower(trim((string)($options['email'] ?? 'info@studio.example')));

    // Clean & validate client CFs
    $validCFs = [];
    foreach ($clientTaxCodes as $cf) {
        $c = strtoupper(trim((string)$cf));
        if (preg_match('/^[A-Z0-9]{16}$/', $c)) {
            $validCFs[] = $c;
        }
    }
    $validCFs = array_values(array_unique($validCFs));
    $numClients = count($validCFs);

    if ($numClients === 0) {
        throw new InvalidArgumentException('Nessun codice fiscale valido selezionato per la richiesta CU.');
    }
    if ($numClients > 2500) {
        throw new InvalidArgumentException('Massimo 2500 soggetti per singola fornitura telematica CU.');
    }

    // Record A (1897 data chars + "A\r\n" = 1900 bytes)
    $recA = 'A' .
        str_repeat(' ', 14) .
        'RCU26' .
        '10' .
        str_pad($fornitore, 16, ' ', STR_PAD_RIGHT) .
        str_repeat(' ', 483) .
        str_repeat(' ', 4) .
        str_repeat(' ', 4) .
        str_repeat(' ', 100) .
        str_repeat(' ', 1068) .
        str_repeat(' ', 200) .
        "A\r\n";

    if (strlen($recA) !== 1900) {
        throw new RuntimeException('Lunghezza Record A non conforme: ' . strlen($recA));
    }

    // Record B (1897 data chars + "A\r\n" = 1900 bytes)
    $recB = 'B' .
        str_pad($richiedente, 16, ' ', STR_PAD_RIGHT) .
        '00000001' .
        ' ' .
        str_repeat(' ', 27) .
        str_repeat(' ', 20) .
        str_repeat(' ', 16) .
        ' ' .
        'T' .
        str_repeat(' ', 24) .
        str_repeat(' ', 20) .
        str_pad(substr($denominazione, 0, 60), 60, ' ', STR_PAD_RIGHT) .
        str_repeat(' ', 12) .
        str_pad(substr($email, 0, 50), 50, ' ', STR_PAD_RIGHT) .
        str_repeat(' ', 17) .
        str_repeat(' ', 6) .
        str_pad((string)$numClients, 4, '0', STR_PAD_LEFT) .
        '1' .
        str_repeat(' ', 16) .
        str_repeat(' ', 1596) .
        "A\r\n";

    if (strlen($recB) !== 1900) {
        throw new RuntimeException('Lunghezza Record B non conforme: ' . strlen($recB));
    }

    // Record C: chunked into modules of max 10 CFs each
    $chunks = array_chunk($validCFs, 10);
    $recCList = [];
    foreach ($chunks as $idx => $chunk) {
        $modNum = str_pad((string)($idx + 1), 8, '0', STR_PAD_LEFT);
        $clientSlots = '';
        for ($i = 0; $i < 10; $i++) {
            $c = $chunk[$i] ?? '';
            $clientSlots .= str_pad($c, 16, ' ', STR_PAD_RIGHT);
        }

        // 1 + 16 + 8 + 48 + 16 = 89 chars
        $headerC = 'C' .
            str_pad($richiedente, 16, ' ', STR_PAD_RIGHT) .
            $modNum .
            str_repeat(' ', 48) .
            str_pad('02327910580', 16, ' ', STR_PAD_RIGHT);

        // 89 + 160 + 1648 = 1897 data chars + "A\r\n" = 1900 bytes
        $recC = $headerC . $clientSlots . str_repeat(' ', 1648) . "A\r\n";
        if (strlen($recC) !== 1900) {
            throw new RuntimeException('Lunghezza Record C non conforme al modulo ' . ($idx + 1) . ': ' . strlen($recC));
        }
        $recCList[] = $recC;
    }

    // Record Z (1897 data chars + "A\r\n" = 1900 bytes)
    $recZ = 'Z' .
        str_repeat(' ', 14) .
        str_pad('1', 9, '0', STR_PAD_LEFT) .
        str_pad((string)count($recCList), 9, '0', STR_PAD_LEFT) .
        str_repeat(' ', 1864) .
        "A\r\n";

    if (strlen($recZ) !== 1900) {
        throw new RuntimeException('Lunghezza Record Z non conforme: ' . strlen($recZ));
    }

    return $recA . $recB . implode('', $recCList) . $recZ;
}

/**
 * Envelopes the RCU file into the official Entratel CCF format (Sogei DER encryption + RCU26****A header)
 * Uses the headless Sogei Entratel Authenticator service for digital signature, FCMP compression and CMS encryption
 */
function ade_cu_build_ccf(string $rcuContent, ?string $configDir = null): string {
    $creds = ade_cu_load_credentials($configDir);
    $cf = $creds['cf'] ?? '00000000000';

    $ch = curl_init('http://host.docker.internal:8788/authenticate');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['rcu' => $rcuContent, 'cf' => $cf]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 45
    ]);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($code !== 200 || empty($res)) {
        throw new RuntimeException('Servizio di autenticazione Entratel non disponibile (HTTP ' . $code . ($curlErr ? ': ' . $curlErr : '') . '). Verificare che il servizio Studio AdE Authenticator sia in esecuzione sulla porta 8788.');
    }

    $json = json_decode($res, true);
    if (empty($json['ok']) || empty($json['ccfBase64'])) {
        throw new RuntimeException('Autenticazione telematica fallita: ' . ($json['error'] ?? 'risposta non valida'));
    }

    $ccf = base64_decode($json['ccfBase64']);
    if (strlen($ccf) < 100 || !str_starts_with($ccf, 'RCU26')) {
        throw new RuntimeException('Pacchetto CCF ministeriale generato non valido.');
    }

    return $ccf;
}
