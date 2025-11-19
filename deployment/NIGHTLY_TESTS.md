# Nightly Automated Tests

This setup runs integration tests automatically every night in the cloud and sends email alerts if anything breaks.

## Architecture

1. **Test Function** (`run-tests`): A Cloud Function that runs the integration tests
2. **Cloud Scheduler**: Triggers the test function nightly
3. **Email Notifications**: Automatically sent on test failure

## Setup

### Step 1: Set Environment Variables

Set the required environment variables for the test function:

**Windows (PowerShell):**
```powershell
# The function URL to test (your main sync-schedule function)
$env:FUNCTION_URL = "https://sync-schedule-v2ndhgjy3q-uc.a.run.app"

# Email to receive notifications
$env:NOTIFICATION_EMAIL = "your-email@gmail.com"

# Email credentials for sending notifications
$env:GMAIL_USER = "your-email@gmail.com"
$env:GMAIL_APP_PASSWORD = "your-16-character-app-password"
```

**Linux/Mac:**
```bash
export FUNCTION_URL="https://sync-schedule-v2ndhgjy3q-uc.a.run.app"
export NOTIFICATION_EMAIL="your-email@gmail.com"
export GMAIL_USER="your-email@gmail.com"
export GMAIL_APP_PASSWORD="your-16-character-app-password"
```

### Step 2: Deploy the Test Function

**Windows (PowerShell):**
```powershell
.\deployment\deploy-test-function.ps1
```

**Linux/Mac:**
```bash
chmod +x deployment/deploy-test-function.sh
./deployment/deploy-test-function.sh
```

### Step 3: Set Up Cloud Scheduler

**Windows (PowerShell):**
```powershell
.\deployment\setup-test-scheduler.ps1
```

**Linux/Mac:**
```bash
chmod +x deployment/setup-test-scheduler.sh
./deployment/setup-test-scheduler.sh
```

By default, tests run at 2 AM daily. To change the schedule, edit the `$Schedule` parameter in the script or use:

```powershell
.\deployment\setup-test-scheduler.ps1 -Schedule "0 3 * * *"  # 3 AM instead
```

## Manual Testing

Test the function manually:

```powershell
# Get the function URL
$url = gcloud functions describe run-tests --gen2 --region=us-central1 --format="value(serviceConfig.uri)"

# Trigger it
Invoke-WebRequest -Uri $url -Method POST
```

Or trigger the scheduler job:

```powershell
gcloud scheduler jobs run nightly-tests --location=us-central1
```

## Schedule Format

The schedule uses cron format:
- `0 2 * * *` = 2 AM daily
- `0 0 * * *` = Midnight daily
- `0 2 * * 1` = 2 AM every Monday

Time zone is set to `America/New_York` by default. Adjust in the script if needed.

## Email Notifications

When tests fail, you'll receive an email with:
- Test summary (total, passed, failed)
- Details of each failed test
- Function URL and timestamp
- Error messages

## Monitoring

View test function logs:
```powershell
gcloud functions logs read run-tests --gen2 --region=us-central1 --limit=50
```

View scheduler job history:
```powershell
gcloud scheduler jobs describe nightly-tests --location=us-central1
```

## Troubleshooting

**Tests not running?**
- Check scheduler job exists: `gcloud scheduler jobs list --location=us-central1`
- Check function is deployed: `gcloud functions list --gen2 --region=us-central1`
- View scheduler logs: `gcloud logging read "resource.type=cloud_scheduler_job" --limit=10`

**Email not sending?**
- Verify `GMAIL_APP_PASSWORD` is set correctly (16-character App Password, not regular password)
- Check function logs for email errors
- Ensure `SMTP_USER` and `SMTP_PASSWORD` (or `GMAIL_USER` and `GMAIL_APP_PASSWORD`) are set in the function's environment variables

**Tests timing out?**
- Increase function timeout in `deploy-test-function.ps1` (currently 600s = 10 minutes)
- Increase memory if needed (currently 2GB)


