$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$python = Join-Path $backendRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $python)) {
  throw 'Backend dependencies are missing. In backend run: python -m venv .venv; .venv\Scripts\python.exe -m pip install -e .'
}

$env:LUG_ROOT = $backendRoot
$env:LUG_ENV = 'development'
$env:LUG_DATABASE_URL = 'sqlite+aiosqlite:///./data/lug.db'
$env:LUG_FILE_STORAGE_PROVIDER = 'local'
$env:LUG_UPLOAD_SCANNER = 'none'
$env:LUG_UPLOAD_SCAN_REQUIRED = 'false'
$env:LUG_EMAIL_MODE = 'log'
$env:LUG_EMAIL_LOG_CODE = 'true'
$env:LUG_SECURE_COOKIES = 'false'

Set-Location -LiteralPath $backendRoot
Write-Host 'Applying backend database migrations…'
& $python -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw "Alembic migration failed (exit code $LASTEXITCODE)." }

Write-Host 'Starting FastAPI at http://127.0.0.1:4174'
Write-Host 'Development verification and password-reset codes appear in this terminal.'
& $python -m uvicorn app.main:app --host 127.0.0.1 --port 4174 --access-log
if ($LASTEXITCODE -ne 0) { throw "Backend stopped with exit code $LASTEXITCODE." }
