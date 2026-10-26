param(
    [string]$ServerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "..\jazz-recovery-server")
)

$ErrorActionPreference = "Stop"
$WebPath = Split-Path -Parent $PSScriptRoot
$ExpectedWebBranch = "feature/subscription-imei-dashboard-test-20261025"
$ExpectedServerBranch = "feature/local-env-startup-20261025"

function Get-GitBranch([string]$Path) {
    (git -C $Path branch --show-current 2>$null).Trim()
}

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Install Node.js 22.5 or newer (includes npm), then run this script again."
}

$nodeVersion = [version](node -p "process.versions.node")
if ($nodeVersion -lt [version]"22.5.0") {
    throw "Jazz Recovery requires Node.js 22.5 or newer. Detected: $(node --version)"
}

if (-not (Test-Path (Join-Path $ServerPath ".git"))) {
    throw "Backend checkout not found at '$ServerPath'. Keep the website and jazz-recovery-server folders side by side, or pass -ServerPath."
}

$webBranch = Get-GitBranch $WebPath
$serverBranch = Get-GitBranch $ServerPath
if ($webBranch -ne $ExpectedWebBranch) {
    throw "Website branch mismatch ('$webBranch'). Switch this checkout to '$ExpectedWebBranch' and rerun."
}
if ($serverBranch -ne $ExpectedServerBranch) {
    throw "Server branch mismatch ('$serverBranch'). Switch the backend checkout to '$ExpectedServerBranch' and rerun."
}

$envFile = Join-Path $ServerPath ".env"
if (-not (Test-Path $envFile)) {
    $template = Join-Path $ServerPath ".env.local.example"
    if (-not (Test-Path $template)) {
        throw "Missing .env and .env.local.example in the backend folder."
    }
    Copy-Item $template $envFile
    Write-Host "Created backend .env from .env.local.example."
    Write-Host "Edit '$envFile' and set DATABASE_URL plus required private service credentials, then run this script again."
    exit 0
}

foreach ($path in @($ServerPath, $WebPath)) {
    if (-not (Test-Path (Join-Path $path "node_modules"))) {
        Write-Host "Installing dependencies in $path ..."
        Push-Location $path
        try { npm install --no-audit --no-fund } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw "npm install failed in '$path'." }
    }
}

Write-Host "Starting PostgreSQL API in a separate PowerShell window..."
$serverCommand = "Set-Location -LiteralPath '$ServerPath'; npm start; Read-Host 'Press Enter to close this API window'"
Start-Process powershell.exe -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand)

Write-Host "Starting website at http://localhost:5190 ..."
Set-Location $WebPath
npm run dev
