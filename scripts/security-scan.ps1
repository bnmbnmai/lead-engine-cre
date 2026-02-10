<#
.SYNOPSIS
    Security scan script for Lead Engine CRE.
    Runs Snyk dependency audits and Slither contract analysis.

.DESCRIPTION
    - Backend: Snyk/npm audit for dependency vulnerabilities
    - Frontend: Snyk/npm audit for dependency vulnerabilities  
    - Contracts: Slither static analysis for Solidity

.EXAMPLE
    powershell .\scripts\security-scan.ps1
#>

$ErrorActionPreference = 'Continue'
$reportDir = Join-Path $PSScriptRoot '..\reports'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Lead Engine CRE — Security Scan           " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ─── Backend Dependencies ─────────────────────
Write-Host "1. Backend dependency audit..." -ForegroundColor Yellow
$backendDir = Join-Path $PSScriptRoot '..\backend'

try {
    Push-Location $backendDir
    Write-Host "   Running npm audit..."
    npm audit --json 2>$null | Out-File "$reportDir\backend-npm-audit.json" -Encoding UTF8
    npm audit 2>$null | Out-File "$reportDir\backend-npm-audit.txt" -Encoding UTF8
    Write-Host "   npm audit complete → reports/backend-npm-audit.json" -ForegroundColor Green
    
    # Try Snyk if available
    $snykPath = Get-Command snyk -ErrorAction SilentlyContinue
    if ($snykPath) {
        Write-Host "   Running Snyk test..."
        snyk test --json 2>$null | Out-File "$reportDir\backend-snyk.json" -Encoding UTF8
        Write-Host "   Snyk complete → reports/backend-snyk.json" -ForegroundColor Green
    } else {
        Write-Host "   Snyk not installed. Run: npm install -g snyk" -ForegroundColor DarkYellow
        Write-Host "   Falling back to npm audit only." -ForegroundColor DarkYellow
    }
    Pop-Location
} catch {
    Write-Host "   Backend audit failed: $_" -ForegroundColor Red
    Pop-Location
}

# ─── Frontend Dependencies ────────────────────
Write-Host ""
Write-Host "2. Frontend dependency audit..." -ForegroundColor Yellow
$frontendDir = Join-Path $PSScriptRoot '..\frontend'

if (Test-Path $frontendDir) {
    try {
        Push-Location $frontendDir
        npm audit --json 2>$null | Out-File "$reportDir\frontend-npm-audit.json" -Encoding UTF8
        npm audit 2>$null | Out-File "$reportDir\frontend-npm-audit.txt" -Encoding UTF8
        Write-Host "   npm audit complete → reports/frontend-npm-audit.json" -ForegroundColor Green
        Pop-Location
    } catch {
        Write-Host "   Frontend audit failed: $_" -ForegroundColor Red
        Pop-Location
    }
} else {
    Write-Host "   Frontend directory not found, skipping." -ForegroundColor DarkYellow
}

# ─── Contract Analysis ────────────────────────
Write-Host ""
Write-Host "3. Contract security analysis..." -ForegroundColor Yellow
$contractsDir = Join-Path $PSScriptRoot '..\contracts'

if (Test-Path $contractsDir) {
    try {
        Push-Location $contractsDir
        
        # Hardhat compile check
        Write-Host "   Compiling contracts..."
        npx hardhat compile 2>&1 | Out-File "$reportDir\contracts-compile.txt" -Encoding UTF8
        Write-Host "   Compile complete → reports/contracts-compile.txt" -ForegroundColor Green

        # Slither (if installed)
        $slitherPath = Get-Command slither -ErrorAction SilentlyContinue
        if ($slitherPath) {
            Write-Host "   Running Slither..."
            slither . --json "$reportDir\contracts-slither.json" 2>&1 | Out-File "$reportDir\contracts-slither.txt" -Encoding UTF8
            Write-Host "   Slither complete → reports/contracts-slither.json" -ForegroundColor Green
        } else {
            Write-Host "   Slither not installed. Run: pip install slither-analyzer" -ForegroundColor DarkYellow
            Write-Host "   Skipping contract static analysis." -ForegroundColor DarkYellow
        }
        Pop-Location
    } catch {
        Write-Host "   Contract analysis failed: $_" -ForegroundColor Red
        Pop-Location
    }
} else {
    Write-Host "   Contracts directory not found, skipping." -ForegroundColor DarkYellow
}

# ─── Summary ──────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Scan Complete                             " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Reports saved to: $reportDir" -ForegroundColor Green
Write-Host ""

$reports = Get-ChildItem $reportDir -File
foreach ($report in $reports) {
    $size = [math]::Round($report.Length / 1024, 1)
    Write-Host "  ✓ $($report.Name) ($size KB)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  - Review reports for HIGH/CRITICAL vulnerabilities"
Write-Host "  - Fix any dependency CVEs with: cd backend && npm audit fix"
Write-Host "  - Install Snyk for deeper analysis: npm install -g snyk"
Write-Host "  - Install Slither for Solidity: pip install slither-analyzer"
Write-Host ""
