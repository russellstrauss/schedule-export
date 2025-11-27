# Update environment variables for deployed Cloud Function
# This updates variables without redeploying the entire function
# It merges new variables with existing ones, preserving all current settings

param(
    [string]$Region = "us-central1",
    [string]$FunctionName = "sync-schedule"
)

Write-Host "Updating environment variables for: $FunctionName" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan
Write-Host ""

# Try to load from .env file if environment variables aren't set
$envFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $envFile) {
    Write-Host "Reading .env file..." -ForegroundColor Gray
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            # Only set if not already in environment
            if (-not (Get-Item "env:$key" -ErrorAction SilentlyContinue)) {
                [Environment]::SetEnvironmentVariable($key, $value, 'Process')
            }
        }
    }
}

# Get current environment variables from the function
Write-Host "Fetching current environment variables..." -ForegroundColor Gray
$currentEnvVars = @{}
try {
    $currentEnvJson = gcloud functions describe $FunctionName `
        --gen2 `
        --region=$Region `
        --format="json(serviceConfig.environmentVariables)" 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $currentEnvObj = $currentEnvJson | ConvertFrom-Json
        if ($currentEnvObj.serviceConfig.environmentVariables) {
            $currentEnvObj.serviceConfig.environmentVariables.PSObject.Properties | ForEach-Object {
                $currentEnvVars[$_.Name] = $_.Value
            }
            Write-Host "Found $($currentEnvVars.Count) existing environment variables" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "Warning: Could not fetch current environment variables. Proceeding with new variables only." -ForegroundColor Yellow
}

# Build environment variables from current session and merge with existing
$yamlContent = @()

# Variables to update/check (in order of priority - session env vars override existing)
$varsToCheck = @(
    @{Name="RHINO_EMAIL"; SessionVar="RHINO_EMAIL"; Required=$false},
    @{Name="RHINO_PASSWORD"; SessionVar="RHINO_PASSWORD"; Required=$false},
    @{Name="GOOGLE_CLIENT_ID"; SessionVar="GOOGLE_CLIENT_ID"; Required=$false},
    @{Name="GOOGLE_CLIENT_SECRET"; SessionVar="GOOGLE_CLIENT_SECRET"; Required=$false},
    @{Name="GOOGLE_REDIRECT_URI"; SessionVar="GOOGLE_REDIRECT_URI"; Required=$false},
    @{Name="GOOGLE_TOKEN"; SessionVar="GOOGLE_TOKEN"; Required=$false}
)

$hasUpdates = $false
foreach ($var in $varsToCheck) {
    $value = $null
    # Check environment variable using proper PowerShell syntax
    $envVarName = $var.SessionVar
    $sessionValue = (Get-Item "env:$envVarName" -ErrorAction SilentlyContinue).Value
    if ($sessionValue) {
        $value = $sessionValue
        $hasUpdates = $true
        Write-Host "  Found $($var.Name) in environment" -ForegroundColor Gray
    }
    
    # If not in session, use existing value
    if (-not $value -and $currentEnvVars.ContainsKey($var.Name)) {
        $value = $currentEnvVars[$var.Name]
        Write-Host "  Using existing $($var.Name) from function" -ForegroundColor Gray
    }
    
    # Add to YAML if we have a value
    if ($value) {
        # Escape quotes and special characters for YAML
        $escapedValue = $value -replace '"', '\"'
        $yamlLine = $var.Name + ': "' + $escapedValue + '"'
        $yamlContent += $yamlLine
    }
}

# Add any other existing variables that weren't in our list
foreach ($key in $currentEnvVars.Keys) {
    $isInList = $varsToCheck | Where-Object { $_.Name -eq $key }
    if (-not $isInList) {
        $value = $currentEnvVars[$key]
        $escapedValue = $value -replace '"', '\"'
        $yamlLine = $key + ': "' + $escapedValue + '"'
        $yamlContent += $yamlLine
    }
}

if ($yamlContent.Count -eq 0) {
    Write-Host "No environment variables to set." -ForegroundColor Yellow
    Write-Host "Set environment variables first (e.g., `$env:RHINO_EMAIL = 'your-email@example.com')" -ForegroundColor Yellow
    exit 1
}

# Create a temporary YAML file
$envVarsFile = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.yaml'
$yamlContent -join "`n" | Out-File -FilePath $envVarsFile -Encoding utf8 -NoNewline

Write-Host "Updating environment variables..." -ForegroundColor Yellow
if ($hasUpdates) {
    Write-Host "   (Merging with existing variables, session variables take precedence)" -ForegroundColor Gray
}

# Deploy with env vars file (this replaces all env vars, but we've merged them above)
gcloud functions deploy $FunctionName `
    --gen2 `
    --region=$Region `
    --env-vars-file=$envVarsFile

# Clean up temp file
Remove-Item $envVarsFile -ErrorAction SilentlyContinue

if ($LASTEXITCODE -eq 0) {
    Write-Host "Environment variables updated successfully!" -ForegroundColor Green
} else {
    Write-Host "Failed to update environment variables." -ForegroundColor Red
    exit 1
}


