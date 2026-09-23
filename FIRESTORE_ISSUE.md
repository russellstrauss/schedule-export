# Firestore Access Issue - CONSUMER_INVALID Error

## Problem

The Cloud Function `sync-schedule` cannot access Firestore from Cloud Functions Gen2, receiving:
```
HTTP 403: Permission denied on resource project [PROJECT_ID]
reason: CONSUMER_INVALID
```

## Root Cause

This is a known issue with Gen2 Cloud Functions and Firestore Native mode. The compute service account (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) cannot access Firestore even when it has the correct IAM roles.

## Verified Facts

✅ Firestore API is enabled (`firestore.googleapis.com`)  
✅ Firestore database exists (Native mode, us-central1)  
✅ Service account has `roles/editor` and `roles/datastore.user`  
✅ User account CAN access Firestore via gcloud CLI  
✅ Function service account CANNOT access Firestore (CONSUMER_INVALID)  
✅ Using GoogleAuth library doesn't help  
✅ Token length and format are correct (1024 chars, `ya29.c.c0...`)  

## Solutions (Requires Manual Intervention)

### Option 1: Use a Custom Service Account (RECOMMENDED)

1. **Create a dedicated service account:**
   ```bash
   gcloud iam service-accounts create firestore-sync \
     --display-name="Firestore Sync Service Account"
   ```

2. **Grant Firestore permissions:**
   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
     --role="roles/datastore.user"
   ```

3. **Update Cloud Function to use this service account:**
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
     --env-vars-file=/path/to/env-vars.yaml
   ```

### Option 2: Enable Firestore for Default Service Account

The default compute service account may need explicit Firestore access enabled through the Google Cloud Console:

1. Go to https://console.cloud.google.com/iam-admin/iam
2. Find `PROJECT_NUMBER-compute@developer.gserviceaccount.com`
3. Verify it has `roles/datastore.user` or `roles/editor`
4. Go to https://console.cloud.google.com/firestore
5. Check database permissions and ensure the compute service account is listed

### Option 3: Use Firestore SDK (May Still Fail)

The Firestore SDK might work if Application Default Credentials can be properly initialized:

```javascript
import { Firestore } from '@google-cloud/firestore';

const db = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT
});
```

However, this has been tested and still fails with CONSUMER_INVALID in Gen2 Cloud Functions.

## Current Workaround

The function gracefully handles this by skipping IATSE 927 sync when Firestore is unavailable. The sync completes successfully for other sources (Rhino, CrewOne).

## Testing

To test if Firestore access is working, call:
```bash
curl "https://YOUR_FUNCTION_URL?diagnostic=firestore"
```

This will return diagnostic information about authentication and Firestore access.

## Related Issues

- Gen2 Cloud Functions use a different service identity than Gen1
- Firestore Native mode has stricter consumer validation
- The CONSUMER_INVALID error suggests the project/service account relationship isn't properly configured in the Firestore API backend

## References

- [Cloud Functions Gen2 Service Identity](https://cloud.google.com/functions/docs/securing/function-identity)
- [Firestore IAM Roles](https://cloud.google.com/firestore/docs/security/iam)
- [Datastore User Role](https://cloud.google.com/datastore/docs/access/iam)
