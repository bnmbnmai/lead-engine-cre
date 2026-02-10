<#
.SYNOPSIS
    Run Slither static analysis on Lead Engine CRE Solidity contracts.

.DESCRIPTION
    Executes Slither against all contracts, outputs JSON report and
    human-readable summary. Exits non-zero if HIGH findings are detected,
    making it suitable for CI/CD pipelines.

.EXAMPLE
    .\scripts\run-slither.ps1
#>

param(
    [string]$ContractsDir = "contracts",
    [string]$ReportDir = "reports"
)

$ErrorActionPreference = "Stop"
Write-Host "`n=== Slither Contract Audit ===" -ForegroundColor Cyan
Write-Host "  Contracts: $ContractsDir"
Write-Host "  Reports:   $ReportDir`n"

# Ensure report directory exists
if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

# Check Slither installation
$slitherCmd = Get-Command slither -ErrorAction SilentlyContinue
if (-not $slitherCmd) {
    Write-Host "ERROR: Slither not installed." -ForegroundColor Red
    Write-Host "  Install: pip install slither-analyzer" -ForegroundColor Yellow
    Write-Host "  Docs:    https://github.com/crytic/slither" -ForegroundColor Yellow
    exit 1
}

$slitherVersion = & slither --version 2>&1
Write-Host "  Slither version: $slitherVersion" -ForegroundColor DarkGray

# Run Slither with JSON output
$jsonReport = Join-Path $ReportDir "slither-report.json"
$txtReport = Join-Path $ReportDir "slither-report.txt"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "`n  Running Slither analysis..." -ForegroundColor Yellow

try {
    & slither . `
        --json $jsonReport `
        --checklist `
        --filter-paths "node_modules|test|mock" `
        2>&1 | Tee-Object -FilePath $txtReport
} catch {
    Write-Host "  Slither execution completed with findings." -ForegroundColor DarkYellow
}

# Parse results
if (Test-Path $jsonReport) {
    $report = Get-Content $jsonReport -Raw | ConvertFrom-Json
    $detectors = $report.results.detectors

    $high = @($detectors | Where-Object { $_.impact -eq "High" })
    $medium = @($detectors | Where-Object { $_.impact -eq "Medium" })
    $low = @($detectors | Where-Object { $_.impact -eq "Low" })
    $info = @($detectors | Where-Object { $_.impact -eq "Informational" })

    Write-Host "`n  === RESULTS ===" -ForegroundColor Cyan
    Write-Host "    HIGH:          $($high.Count)" -ForegroundColor $(if ($high.Count -gt 0) { "Red" } else { "Green" })
    Write-Host "    MEDIUM:        $($medium.Count)" -ForegroundColor $(if ($medium.Count -gt 0) { "Yellow" } else { "Green" })
    Write-Host "    LOW:           $($low.Count)" -ForegroundColor DarkYellow
    Write-Host "    INFORMATIONAL: $($info.Count)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  JSON report: $jsonReport" -ForegroundColor DarkGray
    Write-Host "  Text report: $txtReport" -ForegroundColor DarkGray
    Write-Host "  Timestamp:   $timestamp" -ForegroundColor DarkGray

    # Generate markdown summary
    $mdReport = Join-Path $ReportDir "slither-summary.md"
    $md = @"
# Slither Audit Summary — Lead Engine CRE

**Date:** $timestamp
**Slither Version:** $slitherVersion

| Severity | Count |
|----------|-------|
| HIGH | $($high.Count) |
| MEDIUM | $($medium.Count) |
| LOW | $($low.Count) |
| INFORMATIONAL | $($info.Count) |

"@

    if ($high.Count -gt 0) {
        $md += "`n## HIGH Findings`n`n"
        foreach ($finding in $high) {
            $md += "- **$($finding.check)**: $($finding.description)`n"
        }
    }

    if ($medium.Count -gt 0) {
        $md += "`n## MEDIUM Findings`n`n"
        foreach ($finding in $medium) {
            $md += "- **$($finding.check)**: $($finding.description)`n"
        }
    }

    $md | Out-File $mdReport -Encoding UTF8
    Write-Host "  Markdown:    $mdReport" -ForegroundColor DarkGray

    # Exit non-zero if HIGH findings (for CI)
    if ($high.Count -gt 0) {
        Write-Host "`n  FAILED: $($high.Count) HIGH severity finding(s) detected." -ForegroundColor Red
        exit 1
    }

    Write-Host "`n  PASSED: No HIGH severity findings." -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n  WARNING: No JSON report generated." -ForegroundColor Yellow
    Write-Host "  Check Slither output above for errors." -ForegroundColor Yellow
    exit 1
}
