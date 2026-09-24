# Google Cloud Service Account Setup for Cloud Agents

This guide explains how to set up Google Cloud service account authentication for deployments from Cursor Cloud Agents (remote agent mode).

## Overview

When deploying from a Cloud Agent environment, you need to authenticate with Google Cloud using a service account instead of user credentials. The service account key is stored as a secret in Cursor Dashboard and made available as the `GCLOUD_SERVICE_ACCOUNT_KEY` environment variable.

## Prerequisites

1. **Google Cloud Project** with billing enabled
2. **Service Account** with appropriate permissions
3. **Access to Cursor Dashboard** to configure secrets

## Step 1: Create a Service Account (if not already done)

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Navigate to **IAM & Admin > Service Accounts**
4. Click **Create Service Account**
5. Fill in the details:
   - **Name**: `cursor-cloud-agent-deployer` (or your preferred name)
   - **Description**: `Service account for Cursor Cloud Agent deployments`
6. Click **Create and Continue**

## Step 2: Grant Required Permissions

Grant the service account the following roles (adjust based on your needs):

### For Cloud Functions Deployment:
- **Cloud Functions Admin** (`roles/cloudfunctions.admin`)
- **Service Account User** (`roles/iam.serviceAccountUser`)
- **Cloud Build Editor** (`roles/cloudbuild.builds.editor`)

### For Cloud Scheduler:
- **Cloud Scheduler Admin** (`roles/cloudscheduler.admin`)

### For Firestore (if using IATSE 927 features):
- **Cloud Datastore User** (`roles/datastore.user`)

### Example: Grant roles via gcloud CLI
```bash
PROJECT_ID="your-project-id"
SERVICE_ACCOUNT_EMAIL="cursor-cloud-agent-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/cloudfunctions.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/cloudscheduler.admin"
```

## Step 3: Create and Download Service Account Key

1. In the Service Accounts page, click on your service account
2. Go to the **Keys** tab
3. Click **Add Key > Create new key**
4. Choose **JSON** format
5. Click **Create**
6. The key file will be downloaded (e.g., `your-project-id-abc123.json`)

**⚠️ Security Warning**: This key file grants access to your GCP project. Keep it secure and never commit it to version control!

## Step 4: Add Secret to Cursor Dashboard

1. Go to [Cursor Dashboard](https://cursor.com/settings)
2. Navigate to **Cloud Agents > Secrets**
3. Click **Add Secret**
4. Fill in:
   - **Name**: `GCLOUD_SERVICE_ACCOUNT_KEY`
   - **Value**: Paste the entire contents of the JSON key file you downloaded
   - **Scope**: Select your repository (or team/user scope as needed)
5. Click **Save**

### Alternative: Base64 Encode the Key

If you prefer, you can base64-encode the key before storing it:

**Linux/Mac:**
```bash
base64 -w 0 your-project-id-abc123.json
```

**Windows PowerShell:**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("your-project-id-abc123.json"))
```

Both raw JSON and base64-encoded formats are supported by the setup scripts.

## Step 5: Run the Setup Script

Once the secret is configured, run the setup script in your Cloud Agent environment:

**Linux/Mac (Bash):**
```bash
chmod +x deployment/setup-gcloud-auth.sh
./deployment/setup-gcloud-auth.sh
```

**Windows (PowerShell):**
```powershell
.\deployment\setup-gcloud-auth.ps1
```

The script will:
1. ✅ Validate the service account key
2. ✅ Extract the project ID
3. ✅ Activate the service account with gcloud CLI
4. ✅ Set the default project
5. ✅ Configure application default credentials

## Step 6: Verify Authentication

After running the setup script, verify authentication:

```bash
# Check active account
gcloud auth list

# Check current project
gcloud config list

# Test access (example: list Cloud Functions)
gcloud functions list --gen2 --region=us-central1
```

## Usage in Deployment Scripts

After authentication is set up, you can use the standard deployment scripts:

```bash
# Deploy Cloud Function
./deployment/deploy-function.sh

# Set up Cloud Scheduler
./deployment/setup-scheduler.sh

# Update environment variables
./deployment/update-env-vars.sh
```

The `GOOGLE_APPLICATION_CREDENTIALS` environment variable is automatically set to point to the service account key, so libraries like `@google-cloud/firestore` will use it automatically.

## Environment Variables Set

After running the setup script, these environment variables are available:

- `GOOGLE_APPLICATION_CREDENTIALS`: Path to the service account key file
- Plus all gcloud configuration (project, account, etc.)

## Troubleshooting

### "GCLOUD_SERVICE_ACCOUNT_KEY environment variable is not set"

**Solution**: Make sure you've added the secret in Cursor Dashboard and that it's enabled for your repository.

### "GCLOUD_SERVICE_ACCOUNT_KEY is not valid JSON"

**Possible causes**:
1. The secret value was corrupted when pasting
2. Extra whitespace or characters were added
3. The JSON file is incomplete

**Solution**: Re-download the service account key and paste it again in Cursor Dashboard. Make sure to copy the entire contents of the file.

### "Permission denied" errors during deployment

**Possible causes**:
1. Service account doesn't have required roles
2. APIs are not enabled in your GCP project

**Solutions**:
1. Review and grant the required roles (see Step 2)
2. Enable required APIs:
   ```bash
   gcloud services enable cloudfunctions.googleapis.com
   gcloud services enable cloudscheduler.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable firestore.googleapis.com
   ```

### "Could not extract project_id from service account key"

**Solution**: Verify the JSON key has a `project_id` field. Re-download the key if necessary.

## Security Best Practices

1. **Least Privilege**: Only grant the minimum required roles to the service account
2. **Key Rotation**: Periodically rotate service account keys (create new, update secret, delete old)
3. **Audit Logs**: Enable Cloud Audit Logs to monitor service account usage
4. **Separate Accounts**: Consider using different service accounts for different environments (dev/staging/prod)

## Cleaning Up

If you need to revoke access:

1. Delete the service account key in GCP Console (IAM & Admin > Service Accounts > Keys tab)
2. Remove or disable the secret in Cursor Dashboard
3. If no longer needed, delete the service account entirely

## Additional Resources

- [GCP Service Accounts Documentation](https://cloud.google.com/iam/docs/service-accounts)
- [Best Practices for Service Accounts](https://cloud.google.com/iam/docs/best-practices-service-accounts)
- [Cursor Cloud Agents Documentation](https://cursor.com/docs/cloud-agents)
