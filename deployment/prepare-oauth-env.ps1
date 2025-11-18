# Helper script to prepare Google OAuth environment variables from local files
# Run this before deploying to extract credentials and token

param(
    [string]$CredentialsPath = "get-schedule\google-calendar\credentials.json",
    [string]$TokenPath = "get-schedule\google-calendar\token.json"
)

Write-Host "Preparing Google OAuth environment variables..." -ForegroundColor Cyan

# Check if files exist
if (-not (Test-Path $CredentialsPath)) {
    Write-Host "Error: credentials.json not found at $CredentialsPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $TokenPath)) {
    Write-Host "Warning: token.json not found at $TokenPath" -ForegroundColor Yellow
    Write-Host "   Run 'node sync.js' locally first to generate token.json" -ForegroundColor Yellow
    exit 1
}

# Read and parse credentials.json
$credentials = Get-Content $CredentialsPath | ConvertFrom-Json
$clientId = $credentials.installed.client_id
$clientSecret = $credentials.installed.client_secret
$redirectUri = $credentials.installed.redirect_uris[0]

# Read token.json
$tokenContent = Get-Content $TokenPath -Raw
$tokenJson = $tokenContent | ConvertFrom-Json | ConvertTo-Json -Compress

# Set environment variables
$env:GOOGLE_CLIENT_ID = $clientId
$env:GOOGLE_CLIENT_SECRET = $clientSecret
$env:GOOGLE_REDIRECT_URI = $redirectUri
$env:GOOGLE_TOKEN = $tokenJson

Write-Host "Environment variables set:" -ForegroundColor Green
Write-Host "   GOOGLE_CLIENT_ID = $clientId" -ForegroundColor Gray
Write-Host "   GOOGLE_CLIENT_SECRET = [hidden]" -ForegroundColor Gray
Write-Host "   GOOGLE_REDIRECT_URI = $redirectUri" -ForegroundColor Gray
Write-Host "   GOOGLE_TOKEN = [set]" -ForegroundColor Gray
Write-Host ""
Write-Host "Next step: Run .\deployment\deploy-function.ps1 to deploy" -ForegroundColor Yellow

