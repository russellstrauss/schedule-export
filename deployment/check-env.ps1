# Check what environment variables are needed and what's in .env

$envFile = Join-Path $PSScriptRoot "..\.env"

Write-Host "Checking .env file..." -ForegroundColor Cyan
Write-Host ""

if (Test-Path $envFile) {
    Write-Host "Found .env file at: $envFile" -ForegroundColor Green
    Write-Host ""
    Write-Host "Current environment variables from .env:" -ForegroundColor Yellow
    
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            if ($key -match 'PASSWORD|SECRET|TOKEN') {
                Write-Host "  $key = [hidden]" -ForegroundColor Gray
            } else {
                Write-Host "  $key = $value" -ForegroundColor Gray
            }
        }
    }
} else {
    Write-Host ".env file not found at: $envFile" -ForegroundColor Red
}

Write-Host ""
Write-Host "Required for test function deployment:" -ForegroundColor Yellow
$hasNotificationEmail = Get-Content $envFile -ErrorAction SilentlyContinue | Select-String -Pattern "^NOTIFICATION_EMAIL=" -Quiet
Write-Host "  NOTIFICATION_EMAIL (where to send test failure emails)" -ForegroundColor $(if ($hasNotificationEmail) { "Green" } else { "Red" })
Write-Host "  FUNCTION_URL (optional, has default)" -ForegroundColor Gray
Write-Host "  GMAIL_USER or SMTP_USER (for sending emails)" -ForegroundColor Gray
Write-Host "  GMAIL_APP_PASSWORD or SMTP_PASSWORD (for sending emails)" -ForegroundColor Gray

