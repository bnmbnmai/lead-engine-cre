<#
.SYNOPSIS
    Deploy Lead Engine contracts to Sepolia and/or Base Sepolia.
.DESCRIPTION
    Compiles, deploys, and verifies contracts. Outputs a .env snippet
    with deployed contract addresses.
.PARAMETER Network
    Target network: sepolia, baseSepolia, or both (default: sepolia)
.EXAMPLE
    .\scripts\deploy-contracts.ps1
    .\scripts\deploy-contracts.ps1 -Network baseSepolia
    .\scripts\deploy-contracts.ps1 -Network both
#>

param(
    [ValidateSet('sepolia', 'baseSepolia', 'both')]
    [string]$Network = 'sepolia'
)

$ErrorActionPreference = 'Stop'
$contractsDir = Join-Path $PSScriptRoot '..\contracts'

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Lead Engine CRE — Contract Deployment     " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ─── Pre-flight checks ───────────────────────
$envFile = Join-Path $PSScriptRoot '..\backend\.env'
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: backend\.env not found. Copy .env.example and fill in values." -ForegroundColor Red
    exit 1
}

# Source env for display
$envContent = Get-Content $envFile -ErrorAction SilentlyContinue
$hasAlchemy = $envContent | Where-Object { $_ -match '^ALCHEMY_API_KEY=.+' }
$hasKey = $envContent | Where-Object { $_ -match '^DEPLOYER_PRIVATE_KEY=.+' }

if (-not $hasAlchemy) { Write-Host "WARNING: ALCHEMY_API_KEY not set in backend\.env" -ForegroundColor Yellow }
if (-not $hasKey) { Write-Host "ERROR: DEPLOYER_PRIVATE_KEY not set in backend\.env" -ForegroundColor Red; exit 1 }

# ─── Compile ──────────────────────────────────
Write-Host "1. Compiling contracts..." -ForegroundColor Yellow
Push-Location $contractsDir
npx hardhat compile
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Write-Host "   Compilation successful." -ForegroundColor Green
Pop-Location

# ─── Deploy function ──────────────────────────
function Deploy-To-Network {
    param([string]$Net)
    
    Write-Host ""
    Write-Host "2. Deploying to $Net..." -ForegroundColor Yellow
    Push-Location $contractsDir
    
    $output = npx hardhat run scripts/deploy.ts --network $Net 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    
    Write-Host $output
    
    if ($exitCode -ne 0) {
        Write-Host "   Deployment to $Net FAILED." -ForegroundColor Red
        Pop-Location
        return
    }
    
    Write-Host "   Deployed to $Net successfully." -ForegroundColor Green

    # ─── Verify contracts ─────────────────────
    Write-Host ""
    Write-Host "3. Verifying contracts on explorer ($Net)..." -ForegroundColor Yellow
    
    # Extract addresses from deploy output
    $aceAddr = [regex]::Match($output, 'ACECompliance:\s+(0x[a-fA-F0-9]{40})').Groups[1].Value
    $nftAddr = [regex]::Match($output, 'LeadNFTv2:\s+(0x[a-fA-F0-9]{40})').Groups[1].Value
    $escrowAddr = [regex]::Match($output, 'RTBEscrow:\s+(0x[a-fA-F0-9]{40})').Groups[1].Value
    $marketAddr = [regex]::Match($output, 'Marketplace:\s+(0x[a-fA-F0-9]{40})').Groups[1].Value
    $creAddr = [regex]::Match($output, 'CREVerifier:\s+(0x[a-fA-F0-9]{40})').Groups[1].Value

    if ($aceAddr) {
        try {
            npx hardhat verify --network $Net $aceAddr 2>$null
            Write-Host "   Verified ACECompliance" -ForegroundColor Green
        } catch { Write-Host "   Verify ACECompliance skipped (may already be verified)" -ForegroundColor DarkYellow }
    }

    # ─── Output .env snippet ──────────────────
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  .env Contract Addresses ($Net)            " -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "# Add these to backend\.env and Render env vars:"
    Write-Host "ACE_CONTRACT_ADDRESS=$aceAddr"
    Write-Host "LEAD_NFT_ADDRESS=$nftAddr"
    Write-Host "ESCROW_CONTRACT_ADDRESS=$escrowAddr"
    Write-Host "MARKETPLACE_ADDRESS=$marketAddr"
    Write-Host "CRE_CONTRACT_ADDRESS=$creAddr"
    Write-Host ""

    Pop-Location
}

# ─── Execute ──────────────────────────────────
if ($Network -eq 'both') {
    Deploy-To-Network 'sepolia'
    Deploy-To-Network 'baseSepolia'
} else {
    Deploy-To-Network $Network
}

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Green
Write-Host "  1. Copy contract addresses to backend\.env"
Write-Host "  2. Set same addresses in Render environment variables"
Write-Host "  3. Fund Chainlink Functions subscription at functions.chain.link"
Write-Host ""
