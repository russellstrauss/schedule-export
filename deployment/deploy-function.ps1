# Deploy Cloud Function for schedule sync
# Make sure you're authenticated: gcloud auth login
# Set your project: gcloud config set project YOUR_PROJECT_ID
# This script automatically checks and renews tokens if needed before deploying

param(
    [string]$ProjectId = (gcloud config get-value project),
    [string]$Region = "us-central1",
    [string]$FunctionName = "sync-schedule",
    [switch]$SkipTokenCheck = $false
)

Write-Host "Deploying Cloud Function: $FunctionName" -ForegroundColor Cyan
Write-Host "Project: $ProjectId" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check and renew token if needed (unless skipped)
if (-not $SkipTokenCheck) {
    Write-Host "Step 1: Checking token status and renewing if needed..." -ForegroundColor Yellow
    Write-Host ""
    
    # Check if renew-auth.ps1 exists
    $renewAuthScript = Join-Path $PSScriptRoot "..\renew-auth.ps1"
    if (Test-Path $renewAuthScript) {
        # Run renew-auth.ps1 with SkipUpdate flag (we'll update env vars during deployment)
        & $renewAuthScript -Region $Region -FunctionName $FunctionName -SkipUpdate
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Warning: Token renewal check failed, but continuing with deployment..." -ForegroundColor Yellow
        }
        Write-Host ""
    } else {
        Write-Host "Warning: renew-auth.ps1 not found. Skipping token check." -ForegroundColor Yellow
        Write-Host ""
    }
}

# Step 2: Prepare environment variables
Write-Host "Step 2: Preparing environment variables..." -ForegroundColor Yellow
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

# Write YAML file with proper format
if ($yamlContent.Count -eq 0) {
    Write-Host "Warning: No environment variables set. Function may not work correctly." -ForegroundColor Yellow
    # Create empty YAML file
    "" | Out-File -FilePath $envVarsFile -Encoding utf8
} else {
    $yamlContent -join "`n" | Out-File -FilePath $envVarsFile -Encoding utf8 -NoNewline
}

# Step 3: Deploy the function with env vars file
Write-Host ""
Write-Host "Step 3: Deploying Cloud Function..." -ForegroundColor Yellow
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

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Deployment complete!" -ForegroundColor Green
    
    # Step 4: Ensure token is up to date (in case renew-auth updated it)
    if (-not $SkipTokenCheck) {
        Write-Host ""
        Write-Host "Step 4: Ensuring token is up to date..." -ForegroundColor Yellow
        $renewAuthScript = Join-Path $PSScriptRoot "..\renew-auth.ps1"
        if (Test-Path $renewAuthScript) {
            # Run renew-auth with SkipUpdate=false to update env vars if token was renewed
            & $renewAuthScript -Region $Region -FunctionName $FunctionName
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Warning: Token update failed, but deployment succeeded." -ForegroundColor Yellow
            }
        }
    }
    
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Run .\setup-scheduler.ps1 to create the Cloud Scheduler job"
    Write-Host "2. The function URL will be displayed above"
} else {
    Write-Host ""
    Write-Host "Deployment failed!" -ForegroundColor Red
    exit 1
}

