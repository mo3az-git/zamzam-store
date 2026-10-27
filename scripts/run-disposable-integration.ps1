$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$composeFile = Join-Path $repoRoot "compose.qa.yaml"
$projectName = "zamzam-qa-$([guid]::NewGuid().ToString('N').Substring(0,12))"
$composePrefix = @("compose", "-f", $composeFile, "-p", $projectName)
$result = 0

Push-Location $repoRoot
try {
  & docker @composePrefix up -d --wait
  if ($LASTEXITCODE -ne 0) { throw "Disposable PostgreSQL/Redis did not become healthy." }

  $env:DATABASE_URL = "postgres://postgres:qa-only-disposable-password@127.0.0.1:5432/zamzam_spike"
  $env:REDIS_URL = "redis://127.0.0.1:6379"
  $env:LOCKING_REDIS_URL = $env:REDIS_URL
  $env:PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = "true"
  $env:STORE_CORS = "http://localhost:8000"
  $env:ADMIN_CORS = "http://localhost:9000"
  $env:AUTH_CORS = "http://localhost:8000,http://localhost:9000"
  $env:JWT_SECRET = "local-qa-only-jwt-secret-0123456789abcdef"
  $env:COOKIE_SECRET = "local-qa-only-cookie-secret-0123456789abcdef"
  $env:PHASE1_DISABLE_ADMIN = "true"
  $env:TS_NODE_PROJECT = (Join-Path $repoRoot "apps/backend/tsconfig.json")

  $steps = @(
    @{ Name = "Migrate disposable Medusa database"; Command = { npm run db:migrate } },
    @{ Name = "Guest cart ownership PostgreSQL/Redis integration"; Command = { node apps/backend/scripts/test-guest-cart-ownership-integration.mjs } },
    @{ Name = "Native shipping readiness and missing-rate integration"; Command = { node apps/backend/scripts/test-native-shipping-readiness.mjs } },
    @{ Name = "27-governorate Medusa geography integration, without options or rates"; Command = { node apps/backend/scripts/test-egypt-governorate-shipping-integration.mjs } }
  )

  foreach ($step in $steps) {
    Write-Host "== $($step.Name) =="
    & $step.Command
    if ($LASTEXITCODE -ne 0) { $result = $LASTEXITCODE; break }
  }
}
catch {
  Write-Error $_
  $result = 1
}
finally {
  & docker @composePrefix down --volumes --remove-orphans
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not fully remove the isolated Compose project $projectName."
    if ($result -eq 0) { $result = 1 }
  }
  Pop-Location
}

exit $result
