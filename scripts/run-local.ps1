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

# Refresh the isolated backend checkout without touching its private .env.
# Refuse to overwrite any tracked local edits; untracked .env is intentionally preserved.
$trackedChanges = git -C $ServerPath diff --quiet
if ($LASTEXITCODE -ne 0) {
    throw "Backend source files have local edits. Nothing was overwritten; review them before updating the isolated backend checkout."
}
git -C $ServerPath diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    throw "Backend source files have staged edits. Nothing was overwritten; review them before updating the isolated backend checkout."
}
git -C $ServerPath fetch origin $ExpectedServerBranch
if ($LASTEXITCODE -ne 0) { throw "Could not check for backend updates. Existing files were left unchanged." }
git -C $ServerPath merge-base --is-ancestor HEAD "origin/$ExpectedServerBranch"
if ($LASTEXITCODE -eq 0) {
    # Local HEAD is already equal to or behind origin; fast-forward only.
    git -C $ServerPath merge --ff-only "origin/$ExpectedServerBranch"
    if ($LASTEXITCODE -ne 0) { throw "Could not safely fast-forward the backend checkout." }
} else {
    git -C $ServerPath merge-base --is-ancestor "origin/$ExpectedServerBranch" HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "Backend checkout and remote branch have diverged. Nothing was reset or overwritten; inspect the checkout manually."
    }
    Write-Host "Backend checkout is ahead of GitHub; leaving its local commits untouched."
}

$envFile = Join-Path $ServerPath ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $ServerPath ".env.local.example") $envFile
    Write-Host "Created '$envFile'. Edit it and set DATABASE_URL and your private credentials, then rerun this script."
    exit 0
}

# Read only the non-secret PORT setting so the Vite proxy targets this exact API,
# rather than accidentally sending requests to an older API on the default port.
$apiPort = 8890
$portLine = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
if ($portLine) {
    $portValue = ($portLine -replace '^\s*PORT\s*=\s*', '').Trim().Trim('"').Trim("'")
    $parsedPort = 0
    if (-not [int]::TryParse($portValue, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
        throw "Invalid PORT in backend .env. Use a number from 1 to 65535."
    }
    $apiPort = $parsedPort
}
$env:LOST_MODE_API_URL = "http://127.0.0.1:$apiPort"
Write-Host "Website API proxy will target the configured local backend port $apiPort."

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
