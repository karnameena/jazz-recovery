param(
    [string]$ServerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "..\jazz-recovery-server-subscription-local")
)

$ErrorActionPreference = "Stop"
$WebPath = Split-Path -Parent $PSScriptRoot
$ExpectedWebBranch = "feature/subscription-imei-dashboard-test-20261025"
$ExpectedServerBranch = "feature/per-user-trial-subscription-ledger-latest-20261025"
$ServerRepo = "https://github.com/karnameena/jazz-recovery-server.git"

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Install Node.js 22.5 or newer (includes npm), then rerun."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Install Git for Windows, then rerun."
}
$nodeVersion = [version](node -p "process.versions.node")
if ($nodeVersion -lt [version]"22.5.0") {
    throw "Jazz Recovery requires Node.js 22.5 or newer. Detected: $(node --version)"
}

$webBranch = (git -C $WebPath branch --show-current 2>$null).Trim()
if ($webBranch -ne $ExpectedWebBranch) {
    throw "Website branch mismatch ('$webBranch'). Pull branch '$ExpectedWebBranch' first."
}

if (-not (Test-Path (Join-Path $ServerPath ".git"))) {
    if (Test-Path $ServerPath) {
        throw "The clean server path already exists but is not a Git checkout: '$ServerPath'. Nothing was changed."
    }
    Write-Host "Creating a separate clean backend checkout. Your existing server folder will not be changed."
    git clone --single-branch --branch $ExpectedServerBranch $ServerRepo $ServerPath
    if ($LASTEXITCODE -ne 0) { throw "Could not clone the compatible backend branch." }
}

$serverBranch = (git -C $ServerPath branch --show-current 2>$null).Trim()
if ($serverBranch -ne $ExpectedServerBranch) {
    throw "Backend branch mismatch ('$serverBranch'). Expected '$ExpectedServerBranch'. Existing files were not changed."
}

$envFile = Join-Path $ServerPath ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $ServerPath ".env.local.example") $envFile
    Write-Host "Created '$envFile'. Edit it and set DATABASE_URL and your private credentials, then rerun this script."
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
$serverCommand = "npm start; Read-Host 'Press Enter to close this API window'"
Start-Process powershell.exe -WorkingDirectory $ServerPath -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand)

Write-Host "Starting website at http://localhost:5190 ..."
Set-Location $WebPath
npm run dev
