# Update GMAIL_APP_PASSWORD in local .env file

param(
    [Parameter(Mandatory=$true)]
    [string]$AppPassword
)

$envFile = Join-Path $PSScriptRoot "..\.env"

if (-not (Test-Path $envFile)) {
    Write-Host "Creating .env file..." -ForegroundColor Yellow
    "" | Out-File -FilePath $envFile -Encoding utf8
}

# Read existing .env file
$content = Get-Content $envFile -Raw

# Remove existing GMAIL_APP_PASSWORD line if it exists
$lines = Get-Content $envFile | Where-Object { $_ -notmatch "^GMAIL_APP_PASSWORD=" }

# Add or update GMAIL_APP_PASSWORD
$lines += "GMAIL_APP_PASSWORD=$AppPassword"

# Write back to file
$lines | Out-File -FilePath $envFile -Encoding utf8

Write-Host "✅ Updated GMAIL_APP_PASSWORD in .env file" -ForegroundColor Green
Write-Host ""
Write-Host "To update the server-side environment variable after deploying:" -ForegroundColor Yellow
Write-Host "  gcloud functions deploy run-tests --gen2 --region=us-central1 --update-env-vars=`"GMAIL_APP_PASSWORD=$AppPassword`"" -ForegroundColor Gray


