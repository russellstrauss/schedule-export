# Setup Google Cloud authentication using service account key from environment variable
# This script is designed for Cloud Agent / CI environments where the service account key
# is provided via the GCLOUD_SERVICE_ACCOUNT_KEY environment variable

$ErrorActionPreference = "Stop"

Write-Host "🔑 Setting up Google Cloud service account authentication..." -ForegroundColor Cyan

# Check if GCLOUD_SERVICE_ACCOUNT_KEY is set
if (-not $env:GCLOUD_SERVICE_ACCOUNT_KEY) {
    Write-Host "❌ Error: GCLOUD_SERVICE_ACCOUNT_KEY environment variable is not set" -ForegroundColor Red
    Write-Host ""
    Write-Host "To fix this:" -ForegroundColor Yellow
    Write-Host "1. Go to Cursor Dashboard (Cloud Agents > Secrets)" -ForegroundColor Gray
    Write-Host "2. Add GCLOUD_SERVICE_ACCOUNT_KEY secret with your service account JSON key" -ForegroundColor Gray
    Write-Host "3. Make sure it's enabled for this repository" -ForegroundColor Gray
    exit 1
}

# Create a temporary file for the service account key
$KeyFile = "$env:TEMP\gcloud-service-account-key.json"

Write-Host "📏 Service account key length: $($env:GCLOUD_SERVICE_ACCOUNT_KEY.Length) characters" -ForegroundColor Gray

# Try to decode as base64 first
$keyContent = $null
try {
    $decodedBytes = [System.Convert]::FromBase64String($env:GCLOUD_SERVICE_ACCOUNT_KEY)
    $keyContent = [System.Text.Encoding]::UTF8.GetString($decodedBytes)
    $keyContent | Out-File -FilePath $KeyFile -Encoding UTF8 -NoNewline
    
    # Validate JSON
    $null = ConvertFrom-Json $keyContent
    Write-Host "✓ Decoded base64-encoded service account key" -ForegroundColor Green
} catch {
    # Not base64, try as raw JSON
    try {
        $keyContent = $env:GCLOUD_SERVICE_ACCOUNT_KEY
        $keyContent | Out-File -FilePath $KeyFile -Encoding UTF8 -NoNewline
        
        # Validate JSON
        $null = ConvertFrom-Json $keyContent
        Write-Host "✓ Using raw JSON service account key" -ForegroundColor Green
    } catch {
        Write-Host "❌ Error: GCLOUD_SERVICE_ACCOUNT_KEY is not valid JSON" -ForegroundColor Red
        Write-Host ""
        Write-Host "Expected format: A GCP service account key JSON file with fields like:" -ForegroundColor Yellow
        Write-Host '  {"type": "service_account", "project_id": "...", "private_key": "...", ...}' -ForegroundColor Gray
        Write-Host ""
        Write-Host "The key can be either:" -ForegroundColor Yellow
        Write-Host "  1. Raw JSON (recommended)" -ForegroundColor Gray
        Write-Host "  2. Base64-encoded JSON" -ForegroundColor Gray
        if (Test-Path $KeyFile) { Remove-Item $KeyFile -Force }
        exit 1
    }
}

# Extract project ID from the service account key
try {
    $keyJson = Get-Content $KeyFile | ConvertFrom-Json
    $ProjectId = $keyJson.project_id
    
    if (-not $ProjectId) {
        throw "project_id not found in service account key"
    }
    
    Write-Host "📦 Project ID: $ProjectId" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Error: Could not extract project_id from service account key" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Gray
    if (Test-Path $KeyFile) { Remove-Item $KeyFile -Force }
    exit 1
}

# Check if gcloud is installed
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: gcloud CLI not found. Please install it first." -ForegroundColor Red
    Write-Host "Download from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    if (Test-Path $KeyFile) { Remove-Item $KeyFile -Force }
    exit 1
}

# Activate the service account
Write-Host "🔐 Activating service account..." -ForegroundColor Yellow
try {
    gcloud auth activate-service-account --key-file="$KeyFile" --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud auth activate-service-account failed with exit code $LASTEXITCODE"
    }
} catch {
    Write-Host "❌ Error activating service account" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Gray
    if (Test-Path $KeyFile) { Remove-Item $KeyFile -Force }
    exit 1
}

# Set the default project
Write-Host "📌 Setting default project..." -ForegroundColor Yellow
try {
    gcloud config set project "$ProjectId" --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud config set project failed with exit code $LASTEXITCODE"
    }
} catch {
    Write-Host "❌ Error setting project" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Gray
    exit 1
}

# Set application default credentials (for libraries like @google-cloud/firestore)
Write-Host "🔧 Setting up application default credentials..." -ForegroundColor Yellow
$env:GOOGLE_APPLICATION_CREDENTIALS = $KeyFile

# Verify authentication
Write-Host ""
Write-Host "✅ Authentication successful!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Current configuration:" -ForegroundColor Cyan
gcloud config list

Write-Host ""
Write-Host "👤 Active account:" -ForegroundColor Cyan
gcloud auth list

Write-Host ""
Write-Host "📝 To use this authentication in your PowerShell session, run:" -ForegroundColor Yellow
Write-Host "   `$env:GOOGLE_APPLICATION_CREDENTIALS = `"$KeyFile`"" -ForegroundColor Gray
Write-Host ""
Write-Host "⚠️  Note: The service account key is stored at $KeyFile" -ForegroundColor Gray
Write-Host "   This is safe for Cloud Agent environments but should not be committed to git." -ForegroundColor Gray
