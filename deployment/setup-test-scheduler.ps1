# Set up Cloud Scheduler to run tests nightly

param(
    [string]$Region = "us-central1",
    [string]$FunctionName = "run-tests",
    [string]$JobName = "nightly-tests",
    [string]$Schedule = "0 2 * * *"  # 2 AM daily (midnight in your timezone, adjust as needed)
)

Write-Host "Setting up Cloud Scheduler for nightly tests..." -ForegroundColor Cyan
Write-Host "Function: $FunctionName" -ForegroundColor Cyan
Write-Host "Schedule: $Schedule (cron format)" -ForegroundColor Cyan
Write-Host ""

# Get the function URL
Write-Host "Getting function URL..." -ForegroundColor Yellow
$functionUrl = gcloud functions describe $FunctionName --gen2 --region=$Region --format="value(serviceConfig.uri)" 2>&1

if ($LASTEXITCODE -ne 0 -or !$functionUrl) {
    Write-Host "Error: Could not find function URL. Make sure the function is deployed first." -ForegroundColor Red
    Write-Host "Run: .\deployment\deploy-test-function.ps1" -ForegroundColor Yellow
    exit 1
}

Write-Host "Function URL: $functionUrl" -ForegroundColor Green
Write-Host ""

# Check if job already exists
$existingJob = gcloud scheduler jobs describe $JobName --location=$Region 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Job already exists. Updating..." -ForegroundColor Yellow
    gcloud scheduler jobs update http $JobName `
        --location=$Region `
        --schedule=$Schedule `
        --uri=$functionUrl `
        --http-method=POST `
        --time-zone="America/New_York"
} else {
    Write-Host "Creating new scheduler job..." -ForegroundColor Yellow
    gcloud scheduler jobs create http $JobName `
        --location=$Region `
        --schedule=$Schedule `
        --uri=$functionUrl `
        --http-method=POST `
        --time-zone="America/New_York" `
        --description="Run integration tests nightly and send email alerts on failure"
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Scheduler job configured!" -ForegroundColor Green
    Write-Host ""
    Write-Host "The tests will run automatically at the scheduled time." -ForegroundColor Cyan
    Write-Host "To test manually, run:" -ForegroundColor Yellow
    Write-Host "  gcloud scheduler jobs run $JobName --location=$Region" -ForegroundColor Gray
} else {
    Write-Host "❌ Failed to create/update scheduler job" -ForegroundColor Red
    exit 1
}


