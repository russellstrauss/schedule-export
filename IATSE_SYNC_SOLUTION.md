# IATSE 927 Sync Solution - Manual Configuration Required

## Current Status

✅ **Production Deployment**: Working  
✅ **Function Execution**: Success  
✅ **Portal Sources (Rhino/CrewOne)**: Configured (currently failing due to scraping issues)  
❌ **IATSE 927 Firestore Sync**: Blocked by CONSUMER_INVALID error  

## The Problem

Cloud Functions Gen2 cannot access Firestore using the default compute service account, even with correct IAM roles. This is a known issue where the Firestore API returns `CONSUMER_INVALID` when accessed from certain service identities.

**Error**: `HTTP 403 Permission denied on resource project - reason: CONSUMER_INVALID`

## Solution: Custom Service Account

A custom service account has been created: `firestore-sync@[PROJECT_ID].iam.gserviceaccount.com`

### Required Manual Steps

You need to grant IAM permissions and redeploy the function with the custom service account. Run these commands with an account that has `roles/owner` or `roles/resourcemanager.projectIamAdmin`:

#### Step 1: Grant Firestore Access

```bash
# Set your project ID
PROJECT_ID=$(gcloud config get-value project)

# Grant Datastore User role (for Firestore access)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Grant Editor role (for full functionality)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/editor"
```

#### Step 2: Redeploy Cloud Function

Create environment variables file (if not already exists):

```bash
cat > /tmp/env-vars.yaml << 'EOF'
GOOGLE_CLOUD_PROJECT: "YOUR_PROJECT_ID"
RHINO_EMAIL: "your-email"
RHINO_PASSWORD: "your-password"
SCHEDULE_SOURCES: "comma,separated,source,names"
CREWONE_EMAIL: "your-email"
CREWONE_PASSWORD: "your-password"
CREWONE_LOGIN_URL: "your-portal-url"
GOOGLE_CLIENT_ID: "your-oauth-client-id"
GOOGLE_CLIENT_SECRET: "your-oauth-client-secret"
GOOGLE_REDIRECT_URI: "http://localhost"
GOOGLE_TOKEN: '{"access_token":"...","refresh_token":"...","scope":"...","token_type":"Bearer","expiry_date":...}'
IATSE_ALLOWED_PHONE: "+15551234567"
GEMINI_API_KEY: "your-api-key"
EOF
```

Deploy with the custom service account:

```bash
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
  --service-account="firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
  --env-vars-file=/tmp/env-vars.yaml
```

#### Step 3: Test Firestore Access

After redeployment, test if Firestore access works:

```bash
# Get the function URL
FUNCTION_URL=$(gcloud functions describe sync-schedule --gen2 --region=us-central1 --format="value(serviceConfig.uri)")

# Test Firestore diagnostic endpoint
curl "${FUNCTION_URL}?diagnostic=firestore" | jq .

# Look for:
# - "success": true
# - "firestore": { "status": 200 }
```

If successful, you should see Firestore data returned instead of a 403 error.

#### Step 4: Test Full Sync

```bash
# Trigger a full sync
curl "${FUNCTION_URL}" | jq .

# Check logs
gcloud functions logs read sync-schedule --gen2 --region=us-central1 --limit=50
```

Look for:
- ✅ No "CONSUMER_INVALID" errors
- ✅ "Fetching schedule from iatse927..." log message
- ✅ Successful calendar sync

## Alternative: Console Configuration

If you prefer using the Google Cloud Console:

1. **Grant Permissions**:
   - Go to https://console.cloud.google.com/iam-admin/iam
   - Find `firestore-sync@[PROJECT_ID].iam.gserviceaccount.com`
   - Click "Edit Principal"
   - Add roles: `Cloud Datastore User` and `Editor`
   - Click "Save"

2. **Redeploy Function**:
   - Go to https://console.cloud.google.com/functions
   - Click on `sync-schedule`
   - Click "Edit"
   - Scroll to "Runtime, build, connections and security settings"
   - Under "Service account", select `firestore-sync@...`
   - Click "Next" then "Deploy"

## Verification Checklist

- [ ] Custom service account has `roles/datastore.user`
- [ ] Custom service account has `roles/editor`  
- [ ] Cloud Function redeployed with `--service-account` flag
- [ ] Diagnostic endpoint returns `"success": true`
- [ ] Full sync shows IATSE messages being processed
- [ ] Calendar events are being created/updated

## Current Workaround

Until this is configured, the function will:
- ✅ Complete successfully
- ⚠️ Skip IATSE 927 sync with warning: "Firestore credentials not available"
- ✅ Process other sources (Rhino, CrewOne)

## Files Modified

- `get-schedule/iatse927-firestore-auth.js` - Updated to use REST API
- `get-schedule/iatse927-message-store.js` - Added REST API fallback
- `main.js` - Added diagnostic endpoint

## Questions?

Run the diagnostic endpoint to see current status:
```bash
curl "$(gcloud functions describe sync-schedule --gen2 --region=us-central1 --format='value(serviceConfig.uri)')?diagnostic=firestore" | jq .
```

This will show:
- Service account being used
- Token information
- Firestore API response status
- Any error details
