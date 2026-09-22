# Cloud Agent Deployment - Quick Reference

This directory now supports automated deployment from Cursor Cloud Agents using Google Cloud service account authentication.

## 📚 Documentation

| File | Purpose |
|------|---------|
| **[CLOUD_AGENT_DEPLOYMENT.md](./CLOUD_AGENT_DEPLOYMENT.md)** | Quick start guide for deploying from Cloud Agents |
| **[GCLOUD_SERVICE_ACCOUNT_SETUP.md](./GCLOUD_SERVICE_ACCOUNT_SETUP.md)** | Complete guide for creating and configuring service accounts |
| **[TROUBLESHOOTING_SERVICE_ACCOUNT.md](./TROUBLESHOOTING_SERVICE_ACCOUNT.md)** | Fix common issues with service account keys |
| **[DEPLOYMENT.md](./DEPLOYMENT.md)** | Original deployment guide (local development) |

## 🚀 Quick Start

### For Cloud Agents

1. **Configure secrets in [Cursor Dashboard](https://cursor.com/settings)**:
   - `GCLOUD_SERVICE_ACCOUNT_KEY` (see setup guide)
   - Other required secrets (RHINO_*, GOOGLE_*, etc.)

2. **Deploy**:
   ```bash
   ./deployment/deploy-function.sh
   ./deployment/setup-scheduler.sh
   ```

That's it! The scripts automatically detect Cloud Agent environment and handle authentication.

### For Local Development

1. **Authenticate** (one time):
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```

2. **Deploy**:
   ```bash
   ./deployment/deploy-function.sh
   ./deployment/setup-scheduler.sh
   ```

## 🔧 Setup Scripts

### Authentication Scripts (New)

- **`setup-gcloud-auth.sh`** - Configure gcloud with service account (Linux/Mac)
- **`setup-gcloud-auth.ps1`** - Configure gcloud with service account (Windows)

These are called automatically by deployment scripts when running in Cloud Agent mode.

### Deployment Scripts (Updated)

All deployment scripts now support both local and Cloud Agent environments:

- **`deploy-function.sh`** - Deploy Cloud Function
- **`setup-scheduler.sh`** - Create Cloud Scheduler job
- **`update-env-vars.sh`** - Update environment variables
- **`deploy-test-function.sh`** - Deploy test function
- **`setup-test-scheduler.sh`** - Setup test scheduler

### OAuth Scripts (Existing)

- **`prepare-oauth-env.sh/ps1`** - Extract OAuth credentials for deployment
- **`renew-auth.sh/ps1`** - Renew Google OAuth tokens
- **`update-gmail-password.sh/ps1`** - Update Gmail app password

## 🔑 Required Secrets

Configure these in [Cursor Dashboard](https://cursor.com/settings) > Cloud Agents > Secrets:

### For Deployment
- `GCLOUD_SERVICE_ACCOUNT_KEY` - GCP service account JSON key

### For Function Runtime
- `RHINO_EMAIL`, `RHINO_PASSWORD`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN`
- `GOOGLE_CLOUD_PROJECT` (optional, extracted from service account key)

### Optional Features
- `SCHEDULE_SOURCES` - Comma-separated list (default: "rhino")
- `CREWONE_EMAIL`, `CREWONE_PASSWORD`, `CREWONE_LOGIN_URL`
- `IATSE_ALLOWED_PHONE`, `GEMINI_API_KEY`, `GEMINI_MODEL`

## ❓ Troubleshooting

### "GCLOUD_SERVICE_ACCOUNT_KEY is not valid JSON"

**Common causes:**
- Key is incomplete (should be 2-3 KB, not bytes)
- Wrong file uploaded (OAuth credentials vs service account key)
- Extra characters or truncation when copying

**Solution:** See [TROUBLESHOOTING_SERVICE_ACCOUNT.md](./TROUBLESHOOTING_SERVICE_ACCOUNT.md)

### "Permission denied" during deployment

**Solution:** Grant required roles to service account:
```bash
PROJECT_ID="your-project-id"
SA_EMAIL="your-sa@your-project.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/cloudfunctions.admin"
```

See [GCLOUD_SERVICE_ACCOUNT_SETUP.md](./GCLOUD_SERVICE_ACCOUNT_SETUP.md) for full list.

### "gcloud: command not found"

The scripts auto-install gcloud to `/tmp/google-cloud-sdk/`. If this fails, install manually:
```bash
cd /tmp
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
tar -xf google-cloud-cli-linux-x86_64.tar.gz
./google-cloud-sdk/install.sh --quiet
export PATH="/tmp/google-cloud-sdk/bin:$PATH"
```

## 📖 Related Documentation

- Main README: [../README.md](../README.md)
- Deployment Guide: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Nightly Tests: [NIGHTLY_TESTS.md](./NIGHTLY_TESTS.md)

## 🔗 External Resources

- [GCP Service Accounts](https://cloud.google.com/iam/docs/service-accounts)
- [Cloud Functions Docs](https://cloud.google.com/functions/docs)
- [Cursor Cloud Agents](https://cursor.com/docs/cloud-agents)
