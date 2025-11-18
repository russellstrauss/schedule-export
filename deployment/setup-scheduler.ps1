# Set up Cloud Scheduler to run the function at midnight
# Make sure the Cloud Function is deployed first

param(
    [string]$ProjectId = (gcloud config get-value project),
    [string]$Region = "us-central1",
    [string]$FunctionName = "sync-schedule",
    [string]$SchedulerJobName = "sync-schedule-midnight",
    [string]$Timezone = "America/New_York"
)

Write-Host "Setting up Cloud Scheduler job: $SchedulerJobName" -ForegroundColor Cyan
Write-Host "Project: $ProjectId" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan
Write-Host "Schedule: 0 0 * * * (midnight daily)" -ForegroundColor Cyan
Write-Host "Timezone: $Timezone" -ForegroundColor Cyan

# First, check if the function exists
Write-Host "Checking if function '$FunctionName' exists..." -ForegroundColor Gray
$functionCheck = gcloud functions describe $FunctionName `
    --gen2 `
    --region=$Region `
    --format="value(name)" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Could not find Cloud Function '$FunctionName'." -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Make sure the function is deployed first by running: .\deployment\deploy-function.ps1" -ForegroundColor Yellow
    Write-Host "2. Check if the function name is correct. Listing available functions..." -ForegroundColor Yellow
    Write-Host ""
    
    # List available gen2 functions (gen2 functions are Cloud Run services)
    Write-Host "Gen2 Functions (Cloud Run services in region $Region):" -ForegroundColor Cyan
    gcloud run services list --region=$Region --format="table(metadata.name,status.url)" 2>&1
    
    Write-Host ""
    # Also try listing all functions (gen1 and gen2) - this lists across all regions
    Write-Host "All Functions (all regions):" -ForegroundColor Cyan
    gcloud functions list --format="table(name,state,updateTime)" 2>&1
    
    Write-Host ""
    Write-Host "If your function has a different name, run:" -ForegroundColor Yellow
    Write-Host "   .\setup-scheduler.ps1 -FunctionName <actual-function-name>" -ForegroundColor Cyan
    exit 1
}

# Get the function URL - try multiple format options for gen2 functions
Write-Host "Getting function URL..." -ForegroundColor Gray
$functionUrlOutput = gcloud functions describe $FunctionName `
    --gen2 `
    --region=$Region `
    --format="value(serviceConfig.uri)" 2>&1

# If that doesn't work, try alternative format
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($functionUrlOutput)) {
    Write-Host "Trying alternative method to get function URL..." -ForegroundColor Gray
    $functionUrlOutput = gcloud functions describe $FunctionName `
        --gen2 `
        --region=$Region `
        --format="get(serviceConfig.uri)" 2>&1
}

# If still no URL, try getting the full function description
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($functionUrlOutput)) {
    Write-Host "Getting full function details..." -ForegroundColor Gray
    $fullDetails = gcloud functions describe $FunctionName `
        --gen2 `
        --region=$Region 2>&1
    
    # Try to extract URL from full output
    if ($fullDetails -match 'uri:\s*(https://[^\s]+)') {
        $functionUrlOutput = $matches[1]
    } elseif ($fullDetails -match 'https://[^\s]+cloudfunctions\.net/[^\s]+') {
        $functionUrlOutput = $matches[0]
    }
}

$FunctionUrl = $functionUrlOutput.Trim()

if ([string]::IsNullOrWhiteSpace($FunctionUrl) -or $FunctionUrl -match "ERROR|error|not found") {
    Write-Host "Error: Could not retrieve Cloud Function URL." -ForegroundColor Red
    Write-Host "Function details:" -ForegroundColor Yellow
    gcloud functions describe $FunctionName --gen2 --region=$Region
    Write-Host ""
    Write-Host "You may need to manually get the URL and create the scheduler job." -ForegroundColor Yellow
    exit 1
}

Write-Host "Function URL: $FunctionUrl" -ForegroundColor Green

# Create the scheduler job
gcloud scheduler jobs create http $SchedulerJobName `
    --location=$Region `
    --schedule="0 0 * * *" `
    --uri="$FunctionUrl" `
    --http-method=GET `
    --time-zone="$Timezone" `
    --description="Run schedule sync at midnight daily" `
    --attempt-deadline=600s

if ($LASTEXITCODE -eq 0) {
    Write-Host "Cloud Scheduler job created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Job details:" -ForegroundColor Yellow
    gcloud scheduler jobs describe $SchedulerJobName --location=$Region
    Write-Host ""
    Write-Host "Test the job manually:" -ForegroundColor Yellow
    Write-Host "   gcloud scheduler jobs run $SchedulerJobName --location=$Region"
} else {
    Write-Host "Job might already exist. To update it, run:" -ForegroundColor Yellow
    Write-Host "   gcloud scheduler jobs update http $SchedulerJobName --location=$Region --schedule=`"0 0 * * *`""
}

