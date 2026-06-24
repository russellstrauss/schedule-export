# Script to sync Google OAuth credentials with Cloud Functions.
# - Browser OAuth runs only when local token.json is missing or has no refresh_token.
# - If local is OK but cloud GOOGLE_TOKEN differs / is missing, updates cloud env from token.json.
# - Optional --Force runs full re-auth (same as missing refresh_token).

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
$needsCloudEnvSync = $false
$reason = ""

# Local OAuth file is usable if it parses and has a refresh_token.
# Stale access-token expiry_date is normal; google-auth refreshes on use.
function Test-LocalCredentialNeedsBrowserOAuth {
    param([string]$TokenPath)
    
    if (-not (Test-Path $TokenPath)) {
        return @{NeedsOAuth = $true; Reason = "Token file does not exist"}
    }
    
    try {
        $tokenContent = Get-Content $TokenPath -Raw | ConvertFrom-Json
        if (-not $tokenContent.refresh_token) {
            return @{NeedsOAuth = $true; Reason = "Token missing refresh_token"}
        }
        return @{NeedsOAuth = $false; Reason = "Local credential has refresh_token"}
    } catch {
        return @{NeedsOAuth = $true; Reason = "Error reading token: $_"}
    }
}

function Get-LocalRefreshToken {
    param([string]$TokenPath)
    if (-not (Test-Path $TokenPath)) { return $null }
    try {
        $tokenContent = Get-Content $TokenPath -Raw | ConvertFrom-Json
        return [string]$tokenContent.refresh_token
    } catch {
        return $null
    }
}

# True if cloud GOOGLE_TOKEN is missing, invalid, or does not match local refresh_token.
# Do not use access-token expiry_date - stored env vars often look "expired" between runs.
function Test-CloudNeedsTokenEnvSync {
    param([string]$Region, [string]$FunctionName, [string]$LocalRefreshToken)
    
    try {
        $functionJson = gcloud functions describe $FunctionName --gen2 --region=$Region --format="json(serviceConfig.environmentVariables)" 2>&1
        if ($LASTEXITCODE -ne 0) {
            return @{NeedsSync = $true; Reason = "Could not fetch Cloud Function environment variables"}
        }
        
        $functionObj = $functionJson | ConvertFrom-Json
        $envVars = $functionObj.serviceConfig.environmentVariables
        
        if (-not $envVars -or -not $envVars.GOOGLE_TOKEN) {
            return @{NeedsSync = $true; Reason = "Cloud Function missing GOOGLE_TOKEN"}
        }
        
        $tokenJson = $envVars.GOOGLE_TOKEN | ConvertFrom-Json
        if (-not $tokenJson.refresh_token) {
            return @{NeedsSync = $true; Reason = "Cloud Function token missing refresh_token"}
        }
        
        if ($LocalRefreshToken -and [string]$tokenJson.refresh_token -ne $LocalRefreshToken) {
            return @{NeedsSync = $true; Reason = "Cloud refresh_token differs from local token.json"}
        }
        
        return @{NeedsSync = $false; Reason = "Cloud GOOGLE_TOKEN matches local refresh credential"}
    } catch {
        return @{NeedsSync = $true; Reason = "Error checking Cloud Function token: $_"}
    }
}

# Check local credential (browser OAuth only if refresh_token missing / file bad)
Write-Host "Checking local token..." -ForegroundColor Yellow
$localResult = Test-LocalCredentialNeedsBrowserOAuth -TokenPath $tokenPath
if ($localResult.NeedsOAuth) {
    Write-Host "  Local token: NEEDS BROWSER OAUTH - $($localResult.Reason)" -ForegroundColor Red
    $needsRenewal = $true
} else {
    Write-Host "  Local token: OK - $($localResult.Reason)" -ForegroundColor Green
}

Write-Host ""

$localRefresh = Get-LocalRefreshToken -TokenPath $tokenPath

# Check whether Cloud env needs the same credential as local token.json
Write-Host "Checking Cloud Function GOOGLE_TOKEN..." -ForegroundColor Yellow
$cloudResult = Test-CloudNeedsTokenEnvSync -Region $Region -FunctionName $FunctionName -LocalRefreshToken $localRefresh
if ($cloudResult.NeedsSync) {
    Write-Host "  Cloud: NEEDS ENV UPDATE - $($cloudResult.Reason)" -ForegroundColor Yellow
    $needsCloudEnvSync = $true
} else {
    Write-Host "  Cloud: OK - $($cloudResult.Reason)" -ForegroundColor Green
}

Write-Host ""

# Determine if renewal is needed
if ($Force) {
    Write-Host "Force renewal requested..." -ForegroundColor Yellow
    $needsRenewal = $true
}

if (-not $needsRenewal -and $needsCloudEnvSync) {
    Write-Host "Local credential is fine; pushing token.json to Cloud Function env (no browser OAuth)." -ForegroundColor Cyan
    Write-Host ""
    if ($SkipUpdate) {
        Write-Host "SkipUpdate is set - deployment will supply GOOGLE_TOKEN from prepare-oauth-env.ps1." -ForegroundColor Gray
        exit 0
    }
    & .\deployment\prepare-oauth-env.ps1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: Failed to prepare OAuth environment variables" -ForegroundColor Yellow
        exit 1
    }
    & .\deployment\update-env-vars.ps1 -Region $Region -FunctionName $FunctionName
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: Failed to update Cloud Function env vars" -ForegroundColor Yellow
        exit 1
    }
    Write-Host ""
    Write-Host "Cloud GOOGLE_TOKEN updated from local token.json." -ForegroundColor Green
    exit 0
}

if (-not $needsRenewal) {
    Write-Host "All tokens are valid. No renewal needed." -ForegroundColor Green
    if ($SkipUpdate) {
        exit 0
    }
    
    # Even if tokens are valid, refresh shell env from files for any follow-up scripts
    Write-Host ""
    Write-Host "Refreshing OAuth env vars from disk..." -ForegroundColor Yellow
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
    node scripts/authorize-calendar.js
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

# Verify new token has refresh_token
Write-Host ""
Write-Host "Verifying new token..." -ForegroundColor Yellow
$newTokenResult = Test-LocalCredentialNeedsBrowserOAuth -TokenPath $tokenPath
if ($newTokenResult.NeedsOAuth) {
    Write-Host "Error: New token is invalid - $($newTokenResult.Reason)" -ForegroundColor Red
    exit 1
}
Write-Host "New token is OK - $($newTokenResult.Reason)" -ForegroundColor Green

Write-Host ""
Write-Host "Token saved to: $tokenPath" -ForegroundColor Green

if ($SkipUpdate) {
    Write-Host ""
    Write-Host 'Skipping Cloud Function env update (SkipUpdate is set).' -ForegroundColor Yellow
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

