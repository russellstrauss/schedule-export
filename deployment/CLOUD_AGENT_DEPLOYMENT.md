# Deploying from Cursor Cloud Agents

This guide explains how to deploy Google Cloud Functions from Cursor Cloud Agents (remote agent mode).

## Quick Start

If you've already configured the `GCLOUD_SERVICE_ACCOUNT_KEY` secret in Cursor Dashboard, deployment is automatic:

```bash
# Deploy the function
./deployment/deploy-function.sh

# Set up the scheduler
./deployment/setup-scheduler.sh
```

The deployment scripts automatically detect the Cloud Agent environment and set up authentication using the service account key.

## First-Time Setup

### 1. Configure Service Account

If you haven't set up a service account yet, follow the comprehensive guide:

📖 **[GCLOUD_SERVICE_ACCOUNT_SETUP.md](./GCLOUD_SERVICE_ACCOUNT_SETUP.md)**

This guide covers:
- Creating a service account in GCP
- Granting required permissions
- Downloading the service account key
- Adding the secret to Cursor Dashboard

### 2. Verify Secret Configuration

Make sure your Cursor Dashboard has these secrets configured:

**Required for deployment:**
- `GCLOUD_SERVICE_ACCOUNT_KEY` - GCP service account JSON key

**Required for the function to work:**
- `RHINO_EMAIL` - Rhino portal email
- `RHINO_PASSWORD` - Rhino portal password
- `GOOGLE_CLIENT_ID` - Google OAuth client ID (from credentials.json)
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_REDIRECT_URI` - Google OAuth redirect URI
- `GOOGLE_TOKEN` - Google OAuth refresh token (JSON, from token.json)

**Optional (for additional features):**
- `SCHEDULE_SOURCES` - Comma-separated list of sources (default: "rhino")
- `CREWONE_EMAIL` - Crew One portal email
- `CREWONE_PASSWORD` - Crew One portal password
- `CREWONE_LOGIN_URL` - Crew One portal login URL
- `IATSE_ALLOWED_PHONE` - Phone number for IATSE SMS ingest
- `GEMINI_API_KEY` - Google AI Studio API key (for IATSE parsing)
- `GEMINI_MODEL` - Gemini model name (optional, default: gemini-2.5-flash)

### 3. Deploy

Once secrets are configured, deploy from a Cloud Agent:

```bash
# Clone and navigate to the repository
cd /workspace

# Deploy the Cloud Function
./deployment/deploy-function.sh

# Set up Cloud Scheduler (runs at midnight daily)
./deployment/setup-scheduler.sh
```

## How It Works

### Automatic Authentication

The deployment scripts (`deploy-function.sh`, `setup-scheduler.sh`, `update-env-vars.sh`) automatically detect when running in a Cloud Agent environment by checking for:

1. `GCLOUD_SERVICE_ACCOUNT_KEY` environment variable
2. Absence of existing gcloud authentication

If both conditions are met, the scripts automatically:
1. Install gcloud CLI (if not already installed)
2. Run `setup-gcloud-auth.sh` to authenticate with the service account
3. Configure the default project
4. Set up application default credentials

### Manual Authentication

If you need to set up authentication manually:

```bash
./deployment/setup-gcloud-auth.sh
```

This creates the service account key file at `/tmp/gcloud-service-account-key.json` and configures gcloud to use it.

## Environment-Specific Differences

### Cloud Agent vs Local Development

| Aspect | Cloud Agent | Local Development |
|--------|-------------|-------------------|
| Authentication | Service account key from secret | User credentials (`gcloud auth login`) |
| gcloud CLI | Auto-installed to `/tmp/` | System-wide installation |
| Credentials file | `/tmp/gcloud-service-account-key.json` | `~/.config/gcloud/` |
| OAuth tokens | From environment variables | From local `token.json` file |

### Why Service Accounts?

Cloud Agents are automated environments without browser access, so:
- ❌ Can't use `gcloud auth login` (requires browser)
- ✅ Must use service account keys
- ✅ Secrets are managed securely in Cursor Dashboard
- ✅ Keys never touch your local machine or git repository

## Deployment Scripts

All deployment scripts now support Cloud Agent environments:

### deploy-function.sh
Deploys the Cloud Function with environment variables.

```bash
./deployment/deploy-function.sh [PROJECT_ID] [REGION] [SKIP_TOKEN_CHECK]
```

- **PROJECT_ID**: GCP project (default: from gcloud config)
- **REGION**: Deployment region (default: us-central1)
- **SKIP_TOKEN_CHECK**: Skip OAuth token renewal (default: false)

### setup-scheduler.sh
Creates a Cloud Scheduler job to run the function at midnight daily.

```bash
./deployment/setup-scheduler.sh [PROJECT_ID] [REGION] [TIMEZONE]
```

- **PROJECT_ID**: GCP project (default: from gcloud config)
- **REGION**: Deployment region (default: us-central1)
- **TIMEZONE**: Timezone for schedule (default: America/New_York)

### update-env-vars.sh
Updates environment variables without full redeployment.

```bash
./deployment/update-env-vars.sh [REGION]
```

- **REGION**: Deployment region (default: us-central1)

## Troubleshooting

### "GCLOUD_SERVICE_ACCOUNT_KEY environment variable is not set"

**Solution**: Add the secret in [Cursor Dashboard](https://cursor.com/settings) under Cloud Agents > Secrets.

### "Permission denied" during deployment

**Possible causes**:
1. Service account lacks required roles
2. GCP APIs not enabled

**Solutions**:
1. Grant roles (see [GCLOUD_SERVICE_ACCOUNT_SETUP.md](./GCLOUD_SERVICE_ACCOUNT_SETUP.md))
2. Enable APIs:
   ```bash
   gcloud services enable cloudfunctions.googleapis.com
   gcloud services enable cloudscheduler.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   ```

### "gcloud: command not found"

The script auto-installs gcloud to `/tmp/google-cloud-sdk/`. If this fails:

```bash
# Manual installation
cd /tmp
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
tar -xf google-cloud-cli-linux-x86_64.tar.gz
./google-cloud-sdk/install.sh --quiet
export PATH="/tmp/google-cloud-sdk/bin:$PATH"
```

### Function deployment succeeds but function fails at runtime

**Check environment variables**:
```bash
gcloud functions describe sync-schedule --gen2 --region=us-central1 --format="yaml(serviceConfig.environmentVariables)"
```

Make sure all required secrets are set in Cursor Dashboard and are enabled for your repository.

### OAuth token issues

The function needs Google OAuth credentials to access your calendar. Make sure these secrets are set:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_TOKEN`

You can extract these from local files using:
```bash
./deployment/prepare-oauth-env.sh
```

Then set them as secrets in Cursor Dashboard.

## Checking Deployment Status

### View deployed functions
```bash
gcloud functions list --gen2 --region=us-central1
```

### View function details
```bash
gcloud functions describe sync-schedule --gen2 --region=us-central1
```

### View function logs
```bash
gcloud functions logs read sync-schedule --gen2 --region=us-central1 --limit=50
```

### View scheduler jobs
```bash
gcloud scheduler jobs list --location=us-central1
```

### Trigger function manually
```bash
gcloud scheduler jobs run sync-schedule-midnight --location=us-central1
```

Or call the function URL directly:
```bash
FUNCTION_URL=$(gcloud functions describe sync-schedule --gen2 --region=us-central1 --format="value(serviceConfig.uri)")
curl "$FUNCTION_URL"
```

## Security Notes

- Service account keys are stored temporarily at `/tmp/gcloud-service-account-key.json`
- This location is safe for Cloud Agents (ephemeral VMs)
- Keys are never committed to git (already in `.gitignore`)
- The `GOOGLE_APPLICATION_CREDENTIALS` environment variable points to this file
- Secrets are injected at runtime by Cursor Cloud Agent infrastructure

## Next Steps

After successful deployment:

1. **Test the function**: Trigger it manually (see above)
2. **Check logs**: Verify it ran successfully
3. **Monitor scheduled runs**: Check Cloud Scheduler execution history
4. **Update secrets**: If needed, update secrets in Cursor Dashboard and redeploy

## Additional Resources

- [GCP Service Accounts](https://cloud.google.com/iam/docs/service-accounts)
- [Cloud Functions Documentation](https://cloud.google.com/functions/docs)
- [Cloud Scheduler Documentation](https://cloud.google.com/scheduler/docs)
- [Cursor Cloud Agents](https://cursor.com/docs/cloud-agents)
- [Full Deployment Guide](./DEPLOYMENT.md)
