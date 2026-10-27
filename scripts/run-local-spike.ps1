param(
  [string]$PostgresBin,
  [string]$RedisBin,
  [string]$NodeBin,
  [switch]$SkipInstall,
  [switch]$Targeted,
  [ValidateSet('TP-02a','TP-02b','TP-02c','TP-03','TP-04a','TP-04b','TP-06a','TP-06b','TP-07a','TP-07b','TP-08-foundation','TP-08-native-integration','TP-08-recovery','TP-08-operations','TP-09','TP-10','TP-21c','TP-24c')]
  [string[]]$Cases = @('TP-02a','TP-02b','TP-02c','TP-03','TP-04a','TP-04b','TP-06a','TP-06b','TP-07a','TP-07b','TP-08-foundation','TP-08-native-integration','TP-08-recovery','TP-08-operations','TP-09','TP-10','TP-21c','TP-24c')
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $PostgresBin) { $PostgresBin = Join-Path $repoRoot 'artifacts/tools/postgresql/pgsql/bin' }
if (-not $RedisBin) { $RedisBin = Join-Path $repoRoot 'artifacts/tools/redis/Redis-7.2.16-Windows-x64-msys2' }
if (-not $NodeBin) { $NodeBin = Join-Path $repoRoot 'artifacts/tools/node-v24.22.1-win-x64' }
$PostgresBin = (Resolve-Path -LiteralPath $PostgresBin).Path
$RedisBin = (Resolve-Path -LiteralPath $RedisBin).Path
$NodeBin = (Resolve-Path -LiteralPath $NodeBin).Path
$node = Join-Path $NodeBin 'node.exe'
$npm = Join-Path $NodeBin 'npm.cmd'
if (-not (Test-Path -LiteralPath $node)) { throw 'Node 24.22.1 portable runtime is required.' }
$steps = [System.Collections.Generic.List[object]]::new()
$cleanupErrors = [System.Collections.Generic.List[string]]::new()
$runtimeRoot = Join-Path $repoRoot ('artifacts/local-services/' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $runtimeRoot | Out-Null
$dataPath = Join-Path $runtimeRoot 'postgres-data'
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$redisProcess = $null
$initialized = $false
$savedEnvironment = @{}
$environmentNames = @('PATH','DATABASE_URL','REDIS_URL','LOCKING_REDIS_URL','PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES',
  'PHASE1_ALLOW_DISPOSABLE_DB_CREATE_DROP','PHASE1_POSTGRES_IMAGE_REF','PHASE1_REDIS_IMAGE_REF','TS_NODE_PROJECT',
  'GITHUB_SHA','GITHUB_ACTIONS','PHASE1_DISPOSABLE_TEST_PROFILE','PHASE1_DISABLE_ADMIN')
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
function Invoke-Check([string]$Name, [string]$Executable, [string[]]$Arguments) {
  $log = Join-Path $runtimeRoot ($Name + '.log')
  & $Executable @Arguments *> $log
  $exitCode = $LASTEXITCODE
  $steps.Add([ordered]@{ name=$Name; command=(@($Executable) + $Arguments) -join ' '; exitCode=$exitCode; log=$log })
  Write-Output "$Name exit=$exitCode"
  return $exitCode
}
try {
  Set-Location -LiteralPath $repoRoot
  # Never attach to existing local services, including a familiar DB name.
  foreach ($port in @(5432,6379)) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw "Port $port already has a listener; refusing to reuse or stop it." }
  }
  $pgVersion = & (Join-Path $PostgresBin 'postgres.exe') --version
  $redisVersion = & (Join-Path $RedisBin 'redis-server.exe') --version
  if ($pgVersion -notmatch 'PostgreSQL\) 16\.15' -or $redisVersion -notmatch 'v=7\.2\.16 ') { throw 'Expected PostgreSQL 16.15 and Redis 7.2.16.' }
  $env:PATH = $NodeBin + ';' + $env:PATH
  $env:GITHUB_ACTIONS = $null
  $env:PHASE1_DISPOSABLE_TEST_PROFILE = $null
  $env:GITHUB_SHA = (& git rev-parse HEAD).Trim()
  $env:DATABASE_URL = 'postgres://postgres@127.0.0.1:5432/zamzam_spike'
  $env:REDIS_URL = 'redis://127.0.0.1:6379'
  $env:LOCKING_REDIS_URL = $env:REDIS_URL
  $env:TS_NODE_PROJECT = Join-Path $repoRoot 'apps/backend/tsconfig.json'
  $env:PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = 'true'
  $env:PHASE1_ALLOW_DISPOSABLE_DB_CREATE_DROP = 'true'
  $env:PHASE1_POSTGRES_IMAGE_REF = 'native-windows:EDB/PostgreSQL-16.15-1'
  $env:PHASE1_REDIS_IMAGE_REF = 'native-windows:redis-windows/7.2.16-msys2'
  $env:PHASE1_DISABLE_ADMIN = 'true'
  if (-not $SkipInstall) {
    $install = Invoke-Check 'npm-ci' $npm @('ci','--strict-peer-deps','--no-audit','--no-fund')
    if ($install[-1] -ne 0) { throw 'Strict installation failed; inspect npm-ci.log.' }
  }
  & (Join-Path $PostgresBin 'initdb.exe') -D $dataPath -U postgres -A trust --locale=C --encoding=UTF8 --no-instructions *> (Join-Path $runtimeRoot 'initdb.log')
  if ($LASTEXITCODE -ne 0) { throw 'Disposable cluster initialization failed.' }
  $initialized = $true
  # Native file redirection prevents the detached postgres process inheriting
  # a PowerShell output pipe and keeping the invoking pipeline open forever.
  $pgStart = Start-Process -FilePath $pgCtl -ArgumentList ('-D "' + $dataPath + '" -l "' + (Join-Path $runtimeRoot 'postgres.log') + '" -o "-h 127.0.0.1 -p 5432" -w start') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'pg-start.log') -RedirectStandardError (Join-Path $runtimeRoot 'pg-start.stderr.log')
  # Start-Process -Wait waits for descendants, which includes the DB server.
  # Wait only for pg_ctl, whose -w already checks PostgreSQL readiness.
  $pgStart.WaitForExit()
  if ($pgStart.ExitCode -ne 0) { throw 'Disposable PostgreSQL failed to start.' }
  $redisConfig = Join-Path $runtimeRoot 'redis.conf'
  [IO.File]::WriteAllText($redisConfig, "bind 127.0.0.1`nport 6379`nsave `"`"`nappendonly no`nprotected-mode yes`n")
  $redisProcess = Start-Process -FilePath (Join-Path $RedisBin 'redis-server.exe') -ArgumentList 'redis.conf' -WorkingDirectory $runtimeRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'redis.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'redis.stderr.log')
  $ready = $false
  for ($attempt=0; $attempt -lt 50; $attempt++) {
    $redisProcess.Refresh()
    if ($redisProcess.HasExited) { throw 'Disposable Redis exited; inspect redis.stdout.log.' }
    $pong = & (Join-Path $RedisBin 'redis-cli.exe') -h 127.0.0.1 -p 6379 ping 2>$null
    if ($pong -eq 'PONG') { $ready=$true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $ready) { throw 'Disposable Redis failed to start.' }
  & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p 5432 -U postgres zamzam_spike
  if ($LASTEXITCODE -ne 0) { throw 'Disposable DB creation failed.' }
  $manifest = [ordered]@{ disposable=$true; createdAt=[DateTime]::UtcNow.ToString('o'); dataPath=$dataPath;
    postgresVersion=$pgVersion; redisVersion=$redisVersion; redisPid=$redisProcess.Id; testDatabase='zamzam_spike';
    postgresExecutableSha256=(Get-FileHash (Join-Path $PostgresBin 'postgres.exe')).Hash;
    redisExecutableSha256=(Get-FileHash (Join-Path $RedisBin 'redis-server.exe')).Hash; tp01Authorized=$false }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'service-manifest.json') -Encoding utf8
  $migration = Invoke-Check 'migrations' $npm @('run','db:migrate')
  if ($migration[-1] -ne 0) { throw 'Migrations failed; behavioral tests were not run.' }
  if (-not $Targeted) {
   foreach ($script in @('spike:registry','spike:lint-harness','lint','spike:medusa-loader','build:backend','build:storefront','spike:target-validator','spike:tp02b-unit','spike:tp02c-unit','spike:tp03-negative-control')) {
    $null = Invoke-Check ($script.Replace(':','-')) $npm @('run',$script)
  }
  $null = Invoke-Check 'dependency-tree' $npm @('ls','--all')
  $null = Invoke-Check 'redis-adapter' $npm @('run','spike:locking-redis','--workspace','@zamzam/backend')
  }
  $null = Invoke-Check 'readiness' $npm @('run','spike:tp-readiness')
  foreach ($case in $Cases) { $null = Invoke-Check $case $node @('scripts/run-tp-with-evidence.mjs',$case) }
  if (-not $Targeted) { $null = Invoke-Check 'migration-rollback' $npm @('run','spike:migration-rollback') }
  $null = Invoke-Check 'execution-matrix' $node @('scripts/summarize-phase1-evidence.mjs')
} finally {
  if ($redisProcess) {
    try { $redisProcess.Refresh(); if (-not $redisProcess.HasExited) { Stop-Process -Id $redisProcess.Id -ErrorAction Stop } }
    catch { $cleanupErrors.Add('Redis stop: ' + $_.Exception.Message) }
  }
  if ($initialized) {
    & $pgCtl -D $dataPath -m fast -w stop *> (Join-Path $runtimeRoot 'pg-stop.log')
    if ($LASTEXITCODE -ne 0) { $cleanupErrors.Add('Disposable PostgreSQL stop failed.') }
  }
  [ordered]@{ finishedAt=[DateTime]::UtcNow.ToString('o'); skipInstall=[bool]$SkipInstall; targeted=[bool]$Targeted; steps=@($steps.ToArray()); cleanupErrors=@($cleanupErrors.ToArray()) } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runtimeRoot 'local-run.json') -Encoding utf8
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
  Write-Output "Local run logs: $runtimeRoot"
}
if ($cleanupErrors.Count -or @($steps | Where-Object { $_.exitCode -ne 0 }).Count) { throw 'Local checks failed; consult local-run.json and per-case evidence.' }
