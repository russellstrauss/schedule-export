# Update environment variables for deployed Cloud Function
# This updates variables without redeploying the entire function

param(
    [string]$Region = "us-central1",
    [string]$FunctionName = "sync-schedule"
)

Write-Host "Updating environment variables for: $FunctionName" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan
Write-Host ""

# Build environment variables from current session
$envVars = @()

if ($env:RHINO_EMAIL) { $envVars += "RHINO_EMAIL=$($env:RHINO_EMAIL)" }
if ($env:RHINO_PASSWORD) { $envVars += "RHINO_PASSWORD=$($env:RHINO_PASSWORD)" }
if ($env:GOOGLE_CLIENT_ID) { $envVars += "GOOGLE_CLIENT_ID=$($env:GOOGLE_CLIENT_ID)" }
if ($env:GOOGLE_CLIENT_SECRET) { $envVars += "GOOGLE_CLIENT_SECRET=$($env:GOOGLE_CLIENT_SECRET)" }
if ($env:GOOGLE_REDIRECT_URI) { $envVars += "GOOGLE_REDIRECT_URI=$($env:GOOGLE_REDIRECT_URI)" }
if ($env:GOOGLE_TOKEN) { $envVars += "GOOGLE_TOKEN=$($env:GOOGLE_TOKEN)" }

if ($envVars.Count -eq 0) {
    Write-Host "No environment variables found in current session." -ForegroundColor Yellow
    Write-Host "Set them first, or use --update-env-vars flag with specific values" -ForegroundColor Yellow
    exit 1
}

$envVarsString = $envVars -join ","

Write-Host "Updating environment variables..." -ForegroundColor Yellow
gcloud functions deploy $FunctionName `
    --gen2 `
    --region=$Region `
    --update-env-vars=$envVarsString

Write-Host "Environment variables updated!" -ForegroundColor Green


