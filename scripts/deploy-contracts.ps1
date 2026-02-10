<#
.SYNOPSIS
    Deploy Lead Engine contracts to Sepolia and/or Base Sepolia.
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
Write-Host "============================================"
Write-Host "  Lead Engine CRE - Contract Deployment"
Write-Host "============================================"
Write-Host ""

# Pre-flight checks
$envFile = Join-Path $PSScriptRoot '..\backend\.env'
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: backend\.env not found. Copy .env.example and fill in values." -ForegroundColor Red
    exit 1
}

$envContent = Get-Content $envFile -ErrorAction SilentlyContinue
$hasAlchemy = $envContent | Where-Object { $_ -match '^ALCHEMY_API_KEY=.+' }
$hasKey = $envContent | Where-Object { $_ -match '^DEPLOYER_PRIVATE_KEY=.+' }

if (-not $hasAlchemy) { Write-Host "WARNING: ALCHEMY_API_KEY not set in backend\.env" -ForegroundColor Yellow }
if (-not $hasKey) { Write-Host "ERROR: DEPLOYER_PRIVATE_KEY not set in backend\.env" -ForegroundColor Red; exit 1 }

# Compile
Write-Host "1. Compiling contracts..." -ForegroundColor Yellow
Push-Location $contractsDir
try {
    npx hardhat compile
    if ($LASTEXITCODE -ne 0) { throw "Compilation failed" }
    Write-Host "   Compilation successful." -ForegroundColor Green
} catch {
    Write-Host "   Compilation FAILED: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Deploy function
function Deploy-ToNetwork {
    param([string]$Net)

    Write-Host ""
    Write-Host "2. Deploying to $Net..." -ForegroundColor Yellow
    Push-Location $contractsDir

    try {
        $output = npx hardhat run scripts/deploy.ts --network $Net 2>&1 | Out-String
        Write-Host $output

        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Deployment to $Net FAILED." -ForegroundColor Red
            Pop-Location
            return
        }

        Write-Host "   Deployed to $Net successfully." -ForegroundColor Green

        # Extract addresses from deploy output
        $aceAddr = if ($output -match 'ACECompliance:\s+(0x[a-fA-F0-9]{40})') { $Matches[1] } else { "" }
        $nftAddr = if ($output -match 'LeadNFTv2:\s+(0x[a-fA-F0-9]{40})') { $Matches[1] } else { "" }
        $escrowAddr = if ($output -match 'RTBEscrow:\s+(0x[a-fA-F0-9]{40})') { $Matches[1] } else { "" }
        $marketAddr = if ($output -match 'Marketplace:\s+(0x[a-fA-F0-9]{40})') { $Matches[1] } else { "" }
        $creAddr = if ($output -match 'CREVerifier:\s+(0x[a-fA-F0-9]{40})') { $Matches[1] } else { "" }

        # Output env snippet
        Write-Host ""
        Write-Host "============================================"
        Write-Host "  .env Contract Addresses ($Net)"
        Write-Host "============================================"
        Write-Host ""
        Write-Host "# Add these to backend\.env and Render env vars:"
        Write-Host "ACE_CONTRACT_ADDRESS=$aceAddr"
        Write-Host "LEAD_NFT_ADDRESS=$nftAddr"
        Write-Host "ESCROW_CONTRACT_ADDRESS=$escrowAddr"
        Write-Host "MARKETPLACE_ADDRESS=$marketAddr"
        Write-Host "CRE_CONTRACT_ADDRESS=$creAddr"
        Write-Host ""
    } catch {
        Write-Host "   Deployment error: $_" -ForegroundColor Red
    }

    Pop-Location
}

# Execute
if ($Network -eq 'both') {
    Deploy-ToNetwork 'sepolia'
    Deploy-ToNetwork 'baseSepolia'
} else {
    Deploy-ToNetwork $Network
}

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Green
Write-Host "  1. Copy contract addresses to backend\.env"
Write-Host "  2. Set same addresses in Render environment variables"
Write-Host "  3. Fund Chainlink Functions subscription at functions.chain.link"
Write-Host ""
