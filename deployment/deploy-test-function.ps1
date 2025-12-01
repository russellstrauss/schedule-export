# Deploy Cloud Function for running integration tests
# This function runs tests and sends email notifications on failure

param(
    [string]$ProjectId = (gcloud config get-value project),
    [string]$Region = "us-central1",
    [string]$FunctionName = "run-tests"
)

Write-Host "Deploying Test Function: $FunctionName" -ForegroundColor Cyan
Write-Host "Project: $ProjectId" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan

# Temporary workaround: Change package.json main to tests/test-main.js
# This is needed because Functions Framework looks at package.json main first
$packageJsonPath = Join-Path $PSScriptRoot "..\package.json"
$packageJson = Get-Content $packageJsonPath | ConvertFrom-Json
$originalMain = $packageJson.main
$packageJson.main = "tests/test-main.js"
$packageJson | ConvertTo-Json -Depth 10 | Set-Content $packageJsonPath
Write-Host "Temporarily changed package.json main to tests/test-main.js for deployment" -ForegroundColor Gray

# Load .env file if it exists
$envFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $envFile) {
    Write-Host "Loading environment variables from .env file..." -ForegroundColor Cyan
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            # Remove quotes if present
            if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") {
                $value = $matches[1]
            }
            # Only set if not already set in environment
            if (-not (Get-Item "env:$key" -ErrorAction SilentlyContinue)) {
                Set-Item -Path "env:$key" -Value $value
            }
        }
    }
}

# Create a temporary YAML file for environment variables
$envVarsFile = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.yaml'
$yamlContent = @()

# Add required environment variables
if ($env:FUNCTION_URL) { $yamlContent += "FUNCTION_URL: `"$($env:FUNCTION_URL -replace '"', '\"')`"" } else {
    Write-Host "Warning: FUNCTION_URL not set. Using default." -ForegroundColor Yellow
}

if ($env:NOTIFICATION_EMAIL) { 
    $yamlContent += "NOTIFICATION_EMAIL: `"$($env:NOTIFICATION_EMAIL -replace '"', '\"')`"" 
} else {
    Write-Host "Error: NOTIFICATION_EMAIL is required but not set in .env file or environment." -ForegroundColor Red
    Write-Host "Please add NOTIFICATION_EMAIL=your-email@gmail.com to your .env file" -ForegroundColor Yellow
    exit 1
}

# Email credentials for sending notifications
if ($env:SMTP_USER) { $yamlContent += "SMTP_USER: `"$($env:SMTP_USER -replace '"', '\"')`"" }
if ($env:SMTP_PASSWORD) { $yamlContent += "SMTP_PASSWORD: `"$($env:SMTP_PASSWORD -replace '"', '\"')`"" }
if ($env:GMAIL_USER) { $yamlContent += "GMAIL_USER: `"$($env:GMAIL_USER -replace '"', '\"')`"" }
if ($env:GMAIL_APP_PASSWORD) { $yamlContent += "GMAIL_APP_PASSWORD: `"$($env:GMAIL_APP_PASSWORD -replace '"', '\"')`"" }

# Write YAML file
if ($yamlContent.Count -eq 0) {
    Write-Host "Warning: No environment variables set." -ForegroundColor Yellow
    "" | Out-File -FilePath $envVarsFile -Encoding utf8
} else {
    $yamlContent -join "`n" | Out-File -FilePath $envVarsFile -Encoding utf8 -NoNewline
}

# Deploy the function
Write-Host "Deploying function..." -ForegroundColor Yellow
gcloud functions deploy $FunctionName `
    --gen2 `
    --runtime=nodejs20 `
    --region=$Region `
    --source=. `
    --entry-point=runTests `
    --trigger-http `
    --allow-unauthenticated `
    --memory=2GB `
    --timeout=600s `
    --max-instances=1 `
    --env-vars-file=$envVarsFile `
    --set-build-env-vars="FUNCTION_TARGET=runTests"

# Clean up temp file
Remove-Item $envVarsFile -ErrorAction SilentlyContinue

# Restore original package.json main
$packageJson.main = $originalMain
$packageJson | ConvertTo-Json -Depth 10 | Set-Content $packageJsonPath
Write-Host "Restored package.json main to $originalMain" -ForegroundColor Gray

Write-Host "Test function deployed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: Run .\deployment\setup-test-scheduler.ps1 to schedule nightly tests" -ForegroundColor Yellow

