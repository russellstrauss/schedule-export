# Quick Start: Deploy to Google Cloud Scheduler

## Prerequisites Checklist
- [ ] Google Cloud project created
- [ ] `gcloud` CLI installed and authenticated (`gcloud auth login`)
- [ ] Required APIs enabled (run commands in Step 1 below)
- [ ] `credentials.json` exists in `get-schedule/google-calendar/`
- [ ] `token.json` exists (run `node sync.js` locally first if not)

## Quick Deployment Steps

### 1. Enable APIs
```powershell
gcloud services enable cloudfunctions.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com
```

### 2. Prepare OAuth Environment Variables
```powershell
.\deployment\prepare-oauth-env.ps1
```

### 3. Set Rhino Credentials
```powershell
$env:RHINO_EMAIL = "your-email@example.com"
$env:RHINO_PASSWORD = "your-password"
```

### 4. Deploy Cloud Function
```powershell
.\deployment\deploy-function.ps1
```

### 5. Set Up Scheduler (Runs at Midnight)
```powershell
.\deployment\setup-scheduler.ps1
```

### 6. Test It
```powershell
# Test the function manually
gcloud scheduler jobs run sync-schedule-midnight --location=us-central1

# View logs
gcloud functions logs read sync-schedule --gen2 --region=us-central1 --limit=50
```

## That's It! 🎉

Your script will now run automatically at midnight every day. See `DEPLOYMENT.md` for detailed information and troubleshooting.

