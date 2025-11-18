# Google Cloud Scheduler Setup Guide

This guide will help you deploy your schedule sync script to Google Cloud Functions and set it up to run automatically at midnight using Cloud Scheduler.

## Prerequisites

1. **Google Cloud Project**: You need a Google Cloud project with billing enabled
2. **gcloud CLI**: Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
3. **Authentication**: Run `gcloud auth login` and `gcloud auth application-default login`
4. **APIs Enabled**: Enable the following APIs:
   - Cloud Functions API
   - Cloud Scheduler API
   - Cloud Build API

## Step 1: Enable Required APIs

```bash
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

## Step 2: Set Up Google OAuth Credentials

Your script uses Google OAuth for calendar access. You'll need to:

1. **Create OAuth Credentials** (if not already done):
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Create OAuth 2.0 Client ID credentials
   - Download the credentials as `credentials.json` and place it in `get-schedule/google-calendar/`

2. **Authorize the Application Locally**:
   ```bash
   node sync.js
   ```
   This will create `token.json` with your refresh token.

3. **Upload Credentials to Secret Manager**:
   ```bash
   # Extract values from credentials.json
   # Then create secrets:
   echo -n "YOUR_CLIENT_ID" | gcloud secrets create google-oauth-client-id --data-file=-
   echo -n "YOUR_CLIENT_SECRET" | gcloud secrets create google-oauth-client-secret --data-file=-
   echo -n "YOUR_REDIRECT_URI" | gcloud secrets create google-oauth-redirect-uri --data-file=-
   
   # Upload token.json
   gcloud secrets create google-oauth-token --data-file=get-schedule/google-calendar/token.json
   ```

## Step 3: Prepare OAuth Environment Variables

The `auth.js` file has been updated to read credentials from environment variables when running in Cloud Functions. You need to extract these from your local files:

**Windows (PowerShell):**
```powershell
.\deployment\prepare-oauth-env.ps1
```

**Linux/Mac:**
```bash
chmod +x deployment/prepare-oauth-env.sh
./deployment/prepare-oauth-env.sh
```

This script reads your `credentials.json` and `token.json` files and sets the required environment variables:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_TOKEN` (JSON string)

## Step 4: Set Rhino Credentials

Set your Rhino credentials as environment variables:

**Windows (PowerShell):**
```powershell
$env:RHINO_EMAIL = "your-email@example.com"
$env:RHINO_PASSWORD = "your-password"
```

**Linux/Mac:**
```bash
export RHINO_EMAIL="your-email@example.com"
export RHINO_PASSWORD="your-password"
```

**Note**: If you ran `deployment\prepare-oauth-env.ps1` or `deployment/prepare-oauth-env.sh` in Step 3, the Google OAuth variables are already set. Make sure both Rhino and Google OAuth variables are set before deploying.

## Step 5: Deploy the Cloud Function

**Windows (PowerShell):**
```powershell
.\deployment\deploy-function.ps1
```

**Linux/Mac:**
```bash
chmod +x deployment/deploy-function.sh
./deployment/deploy-function.sh
```

Or manually:
```bash
gcloud functions deploy sync-schedule \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=syncSchedule \
  --trigger=http \
  --allow-unauthenticated \
  --memory=1GB \
  --timeout=540s \
  --max-instances=1 \
  --set-env-vars="RHINO_EMAIL=your-email@example.com,RHINO_PASSWORD=your-password"
```

**Note**: For Puppeteer to work in Cloud Functions, you may need to:
- Use `@sparticuz/chromium` instead of regular puppeteer, or
- Configure puppeteer to use the bundled Chromium

## Step 6: Set Up Cloud Scheduler

**Windows (PowerShell):**
```powershell
.\deployment\setup-scheduler.ps1
```

**Linux/Mac:**
```bash
chmod +x deployment/setup-scheduler.sh
./deployment/setup-scheduler.sh
```

This creates a job that runs at midnight (00:00) daily in your specified timezone (default: America/New_York).

## Step 7: Test the Setup

1. **Test the Cloud Function manually**:
   ```bash
   # Get the function URL
   gcloud functions describe sync-schedule --gen2 --region=us-central1 --format="value(serviceConfig.uri)"
   
   # Call it
   curl <FUNCTION_URL>
   ```

2. **Test the Scheduler job manually**:
   ```bash
   gcloud scheduler jobs run sync-schedule-midnight --location=us-central1
   ```

## Troubleshooting

### Function Timeout
If the function times out, increase the timeout:
```bash
gcloud functions update sync-schedule --gen2 --region=us-central1 --timeout=540s
```

### Puppeteer Issues
If Puppeteer fails in Cloud Functions, consider:
1. Using `@sparticuz/chromium` package
2. Setting `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and using bundled Chromium
3. Increasing memory allocation

### Authentication Errors
- Ensure `token.json` is properly uploaded to Secret Manager
- Verify OAuth credentials are correctly set as secrets
- Check that the refresh token hasn't expired

### View Logs
```bash
gcloud functions logs read sync-schedule --gen2 --region=us-central1 --limit=50
```

## Updating the Schedule

To change the schedule time:
```bash
gcloud scheduler jobs update http sync-schedule-midnight \
  --location=us-central1 \
  --schedule="0 0 * * *"  # Change cron expression as needed
```

Common cron schedules:
- `0 0 * * *` - Midnight daily
- `0 2 * * *` - 2 AM daily
- `0 0 * * 1` - Midnight every Monday
- `*/30 * * * *` - Every 30 minutes

## Cost Considerations

- Cloud Functions: Free tier includes 2 million invocations/month
- Cloud Scheduler: Free tier includes 3 jobs
- Cloud Build: Free tier includes 120 build-minutes/day

For a daily job, you should stay well within free tier limits.

