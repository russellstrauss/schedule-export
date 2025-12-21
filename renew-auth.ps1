# Script to check and renew Google OAuth token, then update Cloud Function
# This script will:
# 1. Check if local token.json exists and is expired
# 2. Check if Cloud Function token is expired
# 3. Automatically renew if expired (or if --Force flag is used)
# 4. Prepare OAuth environment variables
# 5. Update the Cloud Function with the new token

param(
    [string]$Region = "us-central1",
    [string]$FunctionName = "sync-schedule",
    [switch]$SkipUpdate = $false,
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"

Write-Host "Checking Google OAuth Token Status" -ForegroundColor Cyan
Write-Host ""

$tokenPath = "get-schedule\google-calendar\token.json"
$credentialsPath = "get-schedule\google-calendar\credentials.json"
$needsRenewal = $false
$reason = ""

# Function to check if token is expired
function Test-TokenExpired {
    param([string]$TokenPath)
    
    if (-not (Test-Path $TokenPath)) {
        return @{Expired = $true; Reason = "Token file does not exist"}
    }
    
    try {
        $tokenContent = Get-Content $TokenPath -Raw | ConvertFrom-Json
        $expiryDate = $tokenContent.expiry_date
        
        if (-not $expiryDate) {
            return @{Expired = $true; Reason = "Token missing expiry_date"}
        }
        
        # Convert Unix timestamp (milliseconds) to DateTime
        $expiryDateTime = [DateTimeOffset]::FromUnixTimeMilliseconds($expiryDate).DateTime
        $now = Get-Date
        
        # Check if expired (with 1 hour buffer for safety)
        $buffer = New-TimeSpan -Hours 1
        if ($expiryDateTime -lt $now.Add($buffer)) {
            return @{Expired = $true; Reason = "Token expired on $expiryDateTime (current time: $now)"}
        }
        
        # Check if refresh_token exists
        if (-not $tokenContent.refresh_token) {
            return @{Expired = $true; Reason = "Token missing refresh_token"}
        }
        
        return @{Expired = $false; Reason = "Token is valid until $expiryDateTime"}
    } catch {
        return @{Expired = $true; Reason = "Error reading token: $_"}
    }
}

# Function to check Cloud Function token
function Test-CloudFunctionTokenExpired {
    param([string]$Region, [string]$FunctionName)
    
    try {
        $functionJson = gcloud functions describe $FunctionName --gen2 --region=$Region --format="json(serviceConfig.environmentVariables)" 2>&1
        if ($LASTEXITCODE -ne 0) {
            return @{Expired = $true; Reason = "Could not fetch Cloud Function environment variables"}
        }
        
        $functionObj = $functionJson | ConvertFrom-Json
        $envVars = $functionObj.serviceConfig.environmentVariables
        
        if (-not $envVars -or -not $envVars.GOOGLE_TOKEN) {
            return @{Expired = $true; Reason = "Cloud Function missing GOOGLE_TOKEN"}
        }
        
        $tokenJson = $envVars.GOOGLE_TOKEN | ConvertFrom-Json
        $expiryDate = $tokenJson.expiry_date
        
        if (-not $expiryDate) {
            return @{Expired = $true; Reason = "Cloud Function token missing expiry_date"}
        }
        
        $expiryDateTime = [DateTimeOffset]::FromUnixTimeMilliseconds($expiryDate).DateTime
        $now = Get-Date
        
        $buffer = New-TimeSpan -Hours 1
        if ($expiryDateTime -lt $now.Add($buffer)) {
            return @{Expired = $true; Reason = "Cloud Function token expired on $expiryDateTime"}
        }
        
        if (-not $tokenJson.refresh_token) {
            return @{Expired = $true; Reason = "Cloud Function token missing refresh_token"}
        }
        
        return @{Expired = $false; Reason = "Cloud Function token is valid until $expiryDateTime"}
    } catch {
        return @{Expired = $true; Reason = "Error checking Cloud Function token: $_"}
    }
}

# Check local token
Write-Host "Checking local token..." -ForegroundColor Yellow
$localResult = Test-TokenExpired -TokenPath $tokenPath
if ($localResult.Expired) {
    Write-Host "  Local token: EXPIRED or INVALID - $($localResult.Reason)" -ForegroundColor Red
    $needsRenewal = $true
} else {
    Write-Host "  Local token: VALID - $($localResult.Reason)" -ForegroundColor Green
}

Write-Host ""

# Check Cloud Function token
Write-Host "Checking Cloud Function token..." -ForegroundColor Yellow
$cloudResult = Test-CloudFunctionTokenExpired -Region $Region -FunctionName $FunctionName
if ($cloudResult.Expired) {
    Write-Host "  Cloud Function token: EXPIRED or INVALID - $($cloudResult.Reason)" -ForegroundColor Red
    $needsRenewal = $true
} else {
    Write-Host "  Cloud Function token: VALID - $($cloudResult.Reason)" -ForegroundColor Green
}

Write-Host ""

# Determine if renewal is needed
if ($Force) {
    Write-Host "Force renewal requested..." -ForegroundColor Yellow
    $needsRenewal = $true
}

if (-not $needsRenewal) {
    Write-Host "All tokens are valid. No renewal needed." -ForegroundColor Green
    if ($SkipUpdate) {
        exit 0
    }
    
    # Even if tokens are valid, update env vars to ensure they're in sync
    Write-Host ""
    Write-Host "Updating environment variables to ensure sync..." -ForegroundColor Yellow
    & .\deployment\prepare-oauth-env.ps1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: Failed to prepare OAuth environment variables" -ForegroundColor Yellow
    }
    exit 0
}

# Renewal needed
Write-Host "Token renewal required. Starting renewal process..." -ForegroundColor Yellow
Write-Host ""

# Check if credentials exist
if (-not (Test-Path $credentialsPath)) {
    Write-Host "Error: credentials.json not found at $credentialsPath" -ForegroundColor Red
    Write-Host "Please ensure Google OAuth credentials are set up." -ForegroundColor Yellow
    exit 1
}

# Step 1: Delete old token if it exists
if (Test-Path $tokenPath) {
    Write-Host "Removing old token..." -ForegroundColor Yellow
    Remove-Item $tokenPath -Force
    Write-Host "Old token removed" -ForegroundColor Green
} else {
    Write-Host "No existing token found, will create new one" -ForegroundColor Gray
}

Write-Host ""

# Step 2: Run sync.js to trigger re-authentication
Write-Host "Starting OAuth flow..." -ForegroundColor Yellow
Write-Host "   (A browser window will open for authentication)" -ForegroundColor Gray
Write-Host ""

try {
    node sync.js
    Write-Host ""
    Write-Host "Authentication successful!" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "Authentication failed: $_" -ForegroundColor Red
    exit 1
}

# Verify token was created
if (-not (Test-Path $tokenPath)) {
    Write-Host ""
    Write-Host "Error: token.json was not created. Authentication may have failed." -ForegroundColor Red
    exit 1
}

# Verify new token is valid
Write-Host ""
Write-Host "Verifying new token..." -ForegroundColor Yellow
$newTokenResult = Test-TokenExpired -TokenPath $tokenPath
if ($newTokenResult.Expired) {
    Write-Host "Error: New token is invalid - $($newTokenResult.Reason)" -ForegroundColor Red
    exit 1
}
Write-Host "New token is valid - $($newTokenResult.Reason)" -ForegroundColor Green

Write-Host ""
Write-Host "Token saved to: $tokenPath" -ForegroundColor Green

if ($SkipUpdate) {
    Write-Host ""
    Write-Host "Skipping Cloud Function update (--SkipUpdate flag set)" -ForegroundColor Yellow
    Write-Host "   To update manually, run:" -ForegroundColor Gray
    Write-Host "   .\deployment\prepare-oauth-env.ps1" -ForegroundColor Gray
    Write-Host "   .\deployment\update-env-vars.ps1 -Region $Region -FunctionName $FunctionName" -ForegroundColor Gray
    exit 0
}

Write-Host ""

# Step 3: Prepare OAuth environment variables
Write-Host "Preparing OAuth environment variables..." -ForegroundColor Yellow
try {
    & .\deployment\prepare-oauth-env.ps1
    if ($LASTEXITCODE -ne 0) {
        throw "prepare-oauth-env.ps1 failed"
    }
} catch {
    Write-Host ""
    Write-Host "Failed to prepare OAuth environment variables: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 4: Update Cloud Function
Write-Host "Updating Cloud Function environment variables..." -ForegroundColor Yellow
Write-Host "   Function: $FunctionName" -ForegroundColor Gray
Write-Host "   Region: $Region" -ForegroundColor Gray
Write-Host ""

try {
    & .\deployment\update-env-vars.ps1 -Region $Region -FunctionName $FunctionName
    if ($LASTEXITCODE -ne 0) {
        throw "update-env-vars.ps1 failed"
    }
} catch {
    Write-Host ""
    Write-Host "Failed to update Cloud Function: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "You can update manually by running:" -ForegroundColor Yellow
    Write-Host "   .\deployment\update-env-vars.ps1 -Region $Region -FunctionName $FunctionName" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "Token renewal complete!" -ForegroundColor Green
Write-Host "   The Cloud Function has been updated with the new token." -ForegroundColor Gray

