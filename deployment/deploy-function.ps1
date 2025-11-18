# Deploy Cloud Function for schedule sync
# Make sure you're authenticated: gcloud auth login
# Set your project: gcloud config set project YOUR_PROJECT_ID

param(
    [string]$ProjectId = (gcloud config get-value project),
    [string]$Region = "us-central1",
    [string]$FunctionName = "sync-schedule"
)

Write-Host "Deploying Cloud Function: $FunctionName" -ForegroundColor Cyan
Write-Host "Project: $ProjectId" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan

# Build environment variables - use YAML file to handle special characters properly
Write-Host "Setting environment variables..." -ForegroundColor Yellow
Write-Host "   (Make sure RHINO_EMAIL, RHINO_PASSWORD, and Google OAuth vars are set)" -ForegroundColor Gray

# Create a temporary YAML file for environment variables
$envVarsFile = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.yaml'
$yamlContent = @()

# Add required environment variables
if ($env:RHINO_EMAIL) { $yamlContent += "RHINO_EMAIL: `"$($env:RHINO_EMAIL -replace '"', '\"')`"" }
if ($env:RHINO_PASSWORD) { $yamlContent += "RHINO_PASSWORD: `"$($env:RHINO_PASSWORD -replace '"', '\"')`"" }
if ($env:GOOGLE_CLIENT_ID) { $yamlContent += "GOOGLE_CLIENT_ID: `"$($env:GOOGLE_CLIENT_ID -replace '"', '\"')`"" }
if ($env:GOOGLE_CLIENT_SECRET) { $yamlContent += "GOOGLE_CLIENT_SECRET: `"$($env:GOOGLE_CLIENT_SECRET -replace '"', '\"')`"" }
if ($env:GOOGLE_REDIRECT_URI) { $yamlContent += "GOOGLE_REDIRECT_URI: `"$($env:GOOGLE_REDIRECT_URI -replace '"', '\"')`"" }
if ($env:GOOGLE_TOKEN) { 
    # For JSON token, we need to escape it properly - use single quotes in YAML or escape
    $tokenEscaped = $env:GOOGLE_TOKEN -replace '"', '\"' -replace '\$', '\$'
    $yamlContent += "GOOGLE_TOKEN: `"$tokenEscaped`""
}

# Write YAML file
$yamlContent -join "`n" | Out-File -FilePath $envVarsFile -Encoding utf8 -NoNewline

# Deploy the function with env vars file
gcloud functions deploy $FunctionName `
    --gen2 `
    --runtime=nodejs20 `
    --region=$Region `
    --source=. `
    --entry-point=syncSchedule `
    --trigger-http `
    --allow-unauthenticated `
    --memory=1GB `
    --timeout=540s `
    --max-instances=1 `
    --env-vars-file=$envVarsFile

# Clean up temp file
Remove-Item $envVarsFile -ErrorAction SilentlyContinue

Write-Host "Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Run .\setup-scheduler.ps1 to create the Cloud Scheduler job"
Write-Host "2. The function URL will be displayed above"

