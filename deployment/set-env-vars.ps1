# Helper script to set environment variables for deployment
# This sets the variables in the current PowerShell session

Write-Host "Setting up environment variables for Cloud Function deployment..." -ForegroundColor Cyan
Write-Host ""

# Set Rhino credentials
if (-not $env:RHINO_EMAIL) {
    $email = Read-Host "Enter your Rhino email"
    $env:RHINO_EMAIL = $email
} else {
    Write-Host "RHINO_EMAIL is already set" -ForegroundColor Green
}

if (-not $env:RHINO_PASSWORD) {
    $password = Read-Host "Enter your Rhino password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $env:RHINO_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
} else {
    Write-Host "RHINO_PASSWORD is already set" -ForegroundColor Green
}

# Set Google OAuth credentials from local files
Write-Host ""
Write-Host "Setting Google OAuth credentials from local files..." -ForegroundColor Cyan
$prepareScript = Join-Path $PSScriptRoot "prepare-oauth-env.ps1"
& $prepareScript

Write-Host ""
Write-Host "Environment variables set!" -ForegroundColor Green
Write-Host ""
Write-Host "Current environment variables:" -ForegroundColor Yellow
Write-Host "  RHINO_EMAIL: $env:RHINO_EMAIL" -ForegroundColor Gray
Write-Host "  RHINO_PASSWORD: [set]" -ForegroundColor Gray
Write-Host "  GOOGLE_CLIENT_ID: $env:GOOGLE_CLIENT_ID" -ForegroundColor Gray
Write-Host "  GOOGLE_CLIENT_SECRET: [set]" -ForegroundColor Gray
Write-Host "  GOOGLE_REDIRECT_URI: $env:GOOGLE_REDIRECT_URI" -ForegroundColor Gray
Write-Host "  GOOGLE_TOKEN: [set]" -ForegroundColor Gray
Write-Host ""
Write-Host "Next step: Run .\deployment\deploy-function.ps1 to deploy with these variables" -ForegroundColor Cyan

