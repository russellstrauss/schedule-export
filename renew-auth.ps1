# Script to renew Google OAuth token and update Cloud Function
# This script will:
# 1. Delete the old token.json (if it exists)
# 2. Run sync.js to trigger re-authentication
# 3. Prepare OAuth environment variables
# 4. Update the Cloud Function with the new token

param(
    [string]$Region = "us-central1",
    [string]$FunctionName = "sync-schedule",
    [switch]$SkipUpdate = $false
)

$ErrorActionPreference = "Stop"

Write-Host "Renewing Google OAuth Token" -ForegroundColor Cyan
Write-Host ""

$tokenPath = "get-schedule\google-calendar\token.json"

# Step 1: Delete old token if it exists
if (Test-Path $tokenPath) {
    Write-Host "Removing old token..." -ForegroundColor Yellow
    Remove-Item $tokenPath -Force
    Write-Host "Old token removed" -ForegroundColor Green
} else {
    Write-Host "No existing token found, will create new one" -ForegroundColor Gray
}

Write-Host ""

# Step 2: Run sync.js to trigger re-authentication
Write-Host "Starting OAuth flow..." -ForegroundColor Yellow
Write-Host "   (A browser window will open for authentication)" -ForegroundColor Gray
Write-Host ""

try {
    node sync.js
    Write-Host ""
    Write-Host "Authentication successful!" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "Authentication failed: $_" -ForegroundColor Red
    exit 1
}

# Verify token was created
if (-not (Test-Path $tokenPath)) {
    Write-Host ""
    Write-Host "Error: token.json was not created. Authentication may have failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Token saved to: $tokenPath" -ForegroundColor Green

if ($SkipUpdate) {
    Write-Host ""
    Write-Host "Skipping Cloud Function update (--SkipUpdate flag set)" -ForegroundColor Yellow
    Write-Host "   To update manually, run:" -ForegroundColor Gray
    Write-Host "   .\deployment\prepare-oauth-env.ps1" -ForegroundColor Gray
    Write-Host "   .\deployment\update-env-vars.ps1" -ForegroundColor Gray
    exit 0
}

Write-Host ""

# Step 3: Prepare OAuth environment variables
Write-Host "Preparing OAuth environment variables..." -ForegroundColor Yellow
try {
    & .\deployment\prepare-oauth-env.ps1
    if ($LASTEXITCODE -ne 0) {
        throw "prepare-oauth-env.ps1 failed"
    }
} catch {
    Write-Host ""
    Write-Host "Failed to prepare OAuth environment variables: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 4: Update Cloud Function
Write-Host "Updating Cloud Function environment variables..." -ForegroundColor Yellow
Write-Host "   Function: $FunctionName" -ForegroundColor Gray
Write-Host "   Region: $Region" -ForegroundColor Gray
Write-Host ""

try {
    & .\deployment\update-env-vars.ps1 -Region $Region -FunctionName $FunctionName
    if ($LASTEXITCODE -ne 0) {
        throw "update-env-vars.ps1 failed"
    }
} catch {
    Write-Host ""
    Write-Host "Failed to update Cloud Function: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "You can update manually by running:" -ForegroundColor Yellow
    Write-Host "   .\deployment\update-env-vars.ps1 -Region $Region -FunctionName $FunctionName" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "Token renewal complete!" -ForegroundColor Green
Write-Host "   The Cloud Function has been updated with the new token." -ForegroundColor Gray

