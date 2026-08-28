$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI not found. Install Docker Desktop and try again.'
}

$env:DOCKER_INSECURE_NO_IPTABLES_RAW = $null
$savedErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
docker info *> $null
$dockerExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorAction
if ($dockerExitCode -ne 0) {
  throw 'Docker daemon is not running. Start Docker Desktop and try again.'
}

$container = docker ps -a --filter 'name=^lug-mailpit$' --format '{{.Names}}'
if ($container -eq 'lug-mailpit') {
  docker start lug-mailpit *> $null
} else {
  docker run -d --name lug-mailpit --restart unless-stopped -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit:latest *> $null
}

$env:LUG_EMAIL_MODE = 'smtp'
$env:LUG_SMTP_HOST = '127.0.0.1'
$env:LUG_SMTP_PORT = '1025'
$env:LUG_SMTP_SSL = 'false'
$env:LUG_SMTP_STARTTLS = 'false'
$env:LUG_SMTP_FROM = if ($env:LUG_SMTP_FROM) { $env:LUG_SMTP_FROM } else { 'no-reply@lug.test' }
$env:LUG_UPLOAD_SCAN_REQUIRED = if ($env:LUG_UPLOAD_SCAN_REQUIRED) { $env:LUG_UPLOAD_SCAN_REQUIRED } else { 'false' }
if (-not $env:LUG_EMAIL_VERIFICATION_SECRET) {
  $secretBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
  $env:LUG_EMAIL_VERIFICATION_SECRET = ([BitConverter]::ToString($secretBytes) -replace '-', '').ToLowerInvariant()
}

npm start
