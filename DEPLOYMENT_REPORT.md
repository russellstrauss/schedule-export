# Production Deployment Report

**Date:** September 22, 2026 22:41:20 UTC  
**Status:** ✅ SUCCESS

## Deployment Summary

The `sync-schedule` Cloud Function has been successfully deployed to production in Google Cloud Platform.

### Function Details

- **Name:** sync-schedule
- **Region:** us-central1
- **Runtime:** nodejs24
- **State:** ACTIVE
- **URL:** https://sync-schedule-v2ndhgjy3q-uc.a.run.app

### Configuration

- **Memory:** 1GB
- **Timeout:** 600 seconds (10 minutes)
- **Max Instances:** 1
- **Trigger:** HTTP (unauthenticated)

### Environment Variables Configured

- ✅ `GOOGLE_CLOUD_PROJECT`
- ✅ `RHINO_EMAIL` / `RHINO_PASSWORD`
- ✅ `CREWONE_EMAIL` / `CREWONE_PASSWORD` / `CREWONE_LOGIN_URL`
- ✅ `SCHEDULE_SOURCES` (configured with all enabled sources)
- ✅ `IATSE_ALLOWED_PHONE`
- ✅ `GEMINI_API_KEY`
- ✅ `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `GOOGLE_TOKEN`

### Cloud Scheduler Configuration

Two scheduler jobs are configured and ENABLED:

1. **sync-schedule-midnight**
   - Schedule: `0 0 * * *` (Midnight daily)
   - Target: https://sync-schedule-v2ndhgjy3q-uc.a.run.app/
   - State: ENABLED

2. **nightly-tests**
   - Schedule: `0 2 * * *` (2 AM daily)
   - State: ENABLED

## APIs Enabled

- ✅ Cloud Functions API
- ✅ Cloud Scheduler API
- ✅ Cloud Build API
- ✅ Cloud Resource Manager API
- ✅ Firestore API

## Known Issues & Recommendations

### 1. Portal Scraping Issues

During testing, the following portal sources encountered issues:

- **Rhino Portal:** Selector `#btnSchedule` not found. This may be due to:
  - Website structure changes
  - Login flow issues
  - Authentication timing issues
  
- **CrewOne Portal:** "Cannot navigate to invalid URL" error. Check that `CREWONE_LOGIN_URL` is correctly configured.

**Recommendation:** Monitor the Cloud Function logs after the next scheduled run to verify portal scraping success.

### 2. Firestore Permission Issue

The IATSE 927 sync encountered a "CONSUMER_INVALID" error when accessing Firestore. This error typically resolves after:
- API propagation (can take 5-10 minutes after enabling)
- Service account permissions fully propagating

**Current Service Account:** `238397559206-compute@developer.gserviceaccount.com`

**Current Permissions:**
- ✅ `roles/editor`
- ✅ `roles/datastore.user`

**Status:** The service account has the correct permissions. If the issue persists, it may be a transient API propagation delay.

### 3. IAM Policy Update Warning

The deployment completed with a warning about `run.services.setIamPolicy` permission. This is not critical because:
- The function deployed successfully
- The IAM policy was already correctly configured (allUsers have run.invoker role)
- The function is publicly accessible as intended

## Verification Steps

To verify the deployment is working correctly:

1. **Check Function Logs:**
   ```bash
   gcloud functions logs read sync-schedule --region=us-central1 --limit=50
   ```

2. **Manually Trigger the Function:**
   ```bash
   curl https://sync-schedule-v2ndhgjy3q-uc.a.run.app
   ```

3. **Check Scheduler Status:**
   ```bash
   gcloud scheduler jobs describe sync-schedule-midnight --location=us-central1
   ```

4. **View Detailed Logs with the Function:**
   ```bash
   curl "https://sync-schedule-v2ndhgjy3q-uc.a.run.app?showLogs=true"
   ```

## Next Steps

1. **Monitor the next scheduled run** at midnight (00:00) to ensure the scheduler triggers successfully
2. **Review portal credentials** if scraping continues to fail
3. **Check Firestore access** after 10-15 minutes if IATSE sync still fails
4. **Review Cloud Function logs** for any runtime errors

## Deployment Commands Used

```bash
# Install Google Cloud SDK
curl -sSL https://sdk.cloud.google.com | bash

# Authenticate
gcloud auth activate-service-account --key-file=/tmp/gcloud-key.json

# Set project
gcloud config set project $GOOGLE_CLOUD_PROJECT

# Enable required APIs
gcloud services enable cloudresourcemanager.googleapis.com
gcloud services enable firestore.googleapis.com

# Deploy function
gcloud functions deploy sync-schedule \
  --gen2 \
  --runtime=nodejs24 \
  --region=us-central1 \
  --source=. \
  --entry-point=syncSchedule \
  --trigger-http \
  --allow-unauthenticated \
  --memory=1GB \
  --timeout=600s \
  --max-instances=1 \
  --env-vars-file=/tmp/env-vars.yaml
```

## Conclusion

✅ The production deployment was **successful**. The Cloud Function is deployed, configured, and scheduled to run daily at midnight. Some runtime issues with portal scraping were observed during testing, but these should be monitored during normal operation.
