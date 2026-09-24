# Android (Termux) Setup Guide

This guide explains how to set up and run the schedule sync on Android using Termux.

## Current Issues on Android

1. ❌ **Puppeteer**: `@sparticuz/chromium` cannot download binaries for Android ARM64
2. ❌ **Firestore Auth**: `gcloud` CLI authentication not available in Termux
3. ⚠️ **Portal Sources**: Require Puppeteer/Chromium (Rhino, CrewOne)

## Solutions

### Option 1: IATSE-Only Mode (Recommended for Android)

Skip portal sources and use only IATSE 927 with Firestore REST API authentication.

#### Prerequisites

1. **Install Termux** from F-Droid (not Play Store)
2. **Install Node.js in Termux**:
   ```bash
   pkg install nodejs-lts git
   ```

3. **Clone and setup the repository**:
   ```bash
   cd ~/Sites
   git clone <your-repo-url>
   cd cloud-sync
   npm install
   ```

#### Setup IATSE with Service Account

Since `gcloud` CLI is not available on Android, you need to use a service account key file:

1. **On your computer** (with gcloud CLI), create a service account key:
   ```bash
   # Set your project ID
   PROJECT_ID="your-project-id"
   
   # Create service account (if not exists)
   gcloud iam service-accounts create firestore-sync \
     --display-name="Firestore Sync Service Account" \
     --project=$PROJECT_ID
   
   # Grant Firestore permissions
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
     --role="roles/datastore.user"
   
   # Create and download key
   gcloud iam service-accounts keys create ~/firestore-key.json \
     --iam-account=firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com
   ```

2. **Transfer the key file to your Android device**:
   - Use USB, cloud storage, or `termux-setup-storage` and file manager
   - Place it in your Termux home directory: `~/firestore-key.json`

3. **Create `.env` file in Termux**:
   ```bash
   cd ~/Sites/cloud-sync
   nano .env
   ```

   Add these lines:
   ```bash
   # Firestore / GCP
   GOOGLE_CLOUD_PROJECT=your-project-id
   GOOGLE_APPLICATION_CREDENTIALS=/data/data/com.termux/files/home/firestore-key.json
   
   # IATSE 927 (Gemini AI)
   GEMINI_API_KEY=your-gemini-api-key-from-aistudio
   GEMINI_MODEL=gemini-2.5-flash
   
   # Google Calendar OAuth
   GOOGLE_CLIENT_ID=your-oauth-client-id
   GOOGLE_CLIENT_SECRET=your-oauth-client-secret
   GOOGLE_REDIRECT_URI=http://localhost
   GOOGLE_TOKEN='{"access_token":"...","refresh_token":"...","token_type":"Bearer","expiry_date":...}'
   
   # Skip portal sources (they need Puppeteer)
   # SCHEDULE_SOURCES=
   ```

4. **Set secure permissions**:
   ```bash
   chmod 600 ~/firestore-key.json
   chmod 600 .env
   ```

5. **Test the sync**:
   ```bash
   node sync.js
   ```

   Expected output:
   ```
   ⚠️  Portal sync skipped: Cannot download a binary for the provided platform: android (arm64)
   🌐 Fetching schedule from iatse927...
   ✅ Schedule sync completed locally.
   ```

### Option 2: Use Chromium from Termux Repo

If you want to enable portal sources (Rhino, CrewOne), install Chromium in Termux:

1. **Install Chromium**:
   ```bash
   pkg install chromium
   ```

2. **Set Puppeteer to use system Chromium**:
   ```bash
   nano .env
   ```

   Add:
   ```bash
   PUPPETEER_EXECUTABLE_PATH=/data/data/com.termux/files/usr/bin/chromium-browser
   ```

3. **Add portal credentials to `.env`**:
   ```bash
   # Portal sources
   SCHEDULE_SOURCES=rhino
   RHINO_EMAIL=your-email@example.com
   RHINO_PASSWORD=your-password
   ```

4. **Test**:
   ```bash
   node sync.js
   ```

   ⚠️ **Note**: Chromium may be unstable on some Android devices.

### Option 3: Remote Sync (Hybrid Approach)

Run the sync on a cloud server or computer, but trigger it from Android:

1. **Deploy to Google Cloud Functions** (see `DEPLOYMENT.md`)
2. **Call from Android**:
   ```bash
   curl https://your-function-url.cloudfunctions.net/sync-schedule
   ```

3. **Create a Termux shortcut** for easy access:
   ```bash
   mkdir -p ~/.shortcuts
   nano ~/.shortcuts/sync-schedule.sh
   ```

   Add:
   ```bash
   #!/data/data/com.termux/files/usr/bin/bash
   curl -s https://your-function-url/sync-schedule | jq .
   ```

   Make executable:
   ```bash
   chmod +x ~/.shortcuts/sync-schedule.sh
   ```

   Now you can trigger the sync from Termux's widget!

## Environment Variables Summary

### Required for IATSE-Only Mode

```bash
# Firestore
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/data/data/com.termux/files/home/firestore-key.json

# Gemini AI
GEMINI_API_KEY=your-api-key

# Google Calendar
GOOGLE_CLIENT_ID=your-oauth-client-id
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost
GOOGLE_TOKEN='{"access_token":"...","refresh_token":"...","token_type":"Bearer","expiry_date":...}'
```

### Optional (for Portal Sources)

```bash
# System Chromium
PUPPETEER_EXECUTABLE_PATH=/data/data/com.termux/files/usr/bin/chromium-browser

# Rhino
SCHEDULE_SOURCES=rhino  # pragma: allowlist secret
RHINO_EMAIL=your-email
RHINO_PASSWORD=your-password

# CrewOne (add crewOne to SCHEDULE_SOURCES)
SCHEDULE_SOURCES=rhino,crewOne  # pragma: allowlist secret
CREWONE_EMAIL=your-email
CREWONE_PASSWORD=your-password
CREWONE_LOGIN_URL=https://your-portal-url
```

## Getting API Keys

### 1. Google Cloud Project ID

From your computer:
```bash
gcloud config get-value project
```

### 2. Gemini API Key

1. Go to https://aistudio.google.com/apikey
2. Click "Create API Key"
3. Copy the key (starts with `AI...`)

### 3. Google Calendar OAuth Token

Run the auth script on your computer (not Android):
```bash
node renew-auth.sh
```

Or on Windows:
```powershell
.\renew-auth.ps1
```

Copy the entire `GOOGLE_TOKEN` value from the output.

## Troubleshooting

### "Cannot download a binary for the provided platform: android"

This is expected. The error occurs because Puppeteer tries to download Chromium, but it's not available for Android ARM64. Solutions:

- **Use IATSE-only mode** (skip portal sources)
- **Install system Chromium** (`pkg install chromium`)
- **Use cloud deployment** (call Cloud Function from Android)

### "Firestore credentials not available"

You need a service account key file:
1. Create the key on your computer (see Option 1 above)
2. Transfer to Android
3. Set `GOOGLE_APPLICATION_CREDENTIALS` in `.env`

### "No schedule sources ran"

At least one of these must be configured:
- **IATSE**: `GEMINI_API_KEY` + Firestore credentials
- **Portal Source**: `SCHEDULE_SOURCES` with credentials (requires Chromium)

### "Permission denied" for firestore-key.json

```bash
chmod 600 ~/firestore-key.json
```

### Chromium crashes on Android

Some devices don't handle headless Chromium well. Use IATSE-only mode or cloud deployment instead.

## Testing Your Setup

1. **Test Firestore connection**:
   ```bash
   node test-google-auth.js
   ```

2. **Test IATSE sync**:
   ```bash
   node scripts/list-iatse927.js
   ```

3. **Test full sync**:
   ```bash
   node sync.js
   ```

## Automation on Android

### Using Termux:Boot

1. Install Termux:Boot from F-Droid
2. Create boot script:
   ```bash
   mkdir -p ~/.termux/boot
   nano ~/.termux/boot/sync-schedule.sh
   ```

   Add:
   ```bash
   #!/data/data/com.termux/files/usr/bin/bash
   cd ~/Sites/cloud-sync
   node sync.js 2>&1 | tee -a ~/sync.log
   ```

   Make executable:
   ```bash
   chmod +x ~/.termux/boot/sync-schedule.sh
   ```

### Using Termux:Tasker

1. Install Termux:Tasker from F-Droid
2. Create task in Tasker:
   - Action: Termux
   - Executable: `sync-schedule.sh`
   - Working Directory: `/data/data/com.termux/files/home/Sites/cloud-sync`

## Security Notes

⚠️ **Keep your credentials secure:**
- Never commit `.env` or `firestore-key.json` to git
- Set file permissions to `600`
- Consider using cloud deployment for better security
- Rotate service account keys periodically

## Recommended Setup for Android

For best results on Android:

1. ✅ **Use IATSE-only mode** (no Puppeteer dependency)
2. ✅ **Service account key file** (avoid gcloud CLI)
3. ✅ **Cloud deployment** for portal sources (call from Android)
4. ✅ **Termux shortcuts/widgets** for easy triggering

This avoids Android-specific issues while maintaining full functionality.
