# Quick Start: Fixing Firestore Authentication on Android

If you're seeing this error on Android:
```
⚠️  Skipping iatse927: Firestore credentials not available (Firestore auth failed. Run: gcloud auth login && gcloud auth application-default login)
❌ Local sync failed: Error: No schedule sources ran.
```

This means Firestore can't authenticate because `gcloud` CLI is not available on Android. **The solution is to use a service account key file instead.**

## 🎯 Quick Fix (5 minutes)

### Step 1: Create Service Account Key (on your computer)

```bash
# Set your project ID
PROJECT_ID="your-project-id"

# Create service account
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

# Important: This file is sensitive! Keep it secure.
```

### Step 2: Transfer Key to Android

**Option A: USB Cable**
1. Connect your Android device
2. Copy `~/firestore-key.json` to your device
3. Move it to Termux home directory

**Option B: Cloud Storage**
1. Upload `~/firestore-key.json` to Google Drive/Dropbox (temporarily)
2. Download to your Android device
3. Move to Termux: `/data/data/com.termux/files/home/`
4. Delete from cloud storage immediately

**Option C: Termux Storage**
```bash
# In Termux, enable storage access
termux-setup-storage

# Copy from Downloads folder
cp ~/storage/downloads/firestore-key.json ~/firestore-key.json
chmod 600 ~/firestore-key.json
```

### Step 3: Configure .env

```bash
cd ~/Sites/cloud-sync  # or wherever your repo is
nano .env
```

Add these lines:

```bash
# Required
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/data/data/com.termux/files/home/firestore-key.json
GEMINI_API_KEY=your-gemini-api-key

# Google Calendar OAuth (get from renew-auth.sh)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost
GOOGLE_TOKEN='{"access_token":"...","refresh_token":"...","token_type":"Bearer","expiry_date":...}'
```

Save and exit (Ctrl+X, Y, Enter).

### Step 4: Install Dependencies

```bash
npm install
```

### Step 5: Test

```bash
# Test Firestore authentication
node test-firestore-auth.js

# If successful, test the sync
node sync.js
```

Expected output:
```
🌐 Fetching schedule from iatse927...
✅ Schedule sync completed locally.
```

## 🔒 Security

Your service account key is sensitive! Protect it:

```bash
# Set restrictive permissions
chmod 600 ~/firestore-key.json

# Never commit to git
echo "firestore-key.json" >> .gitignore
```

## 🔧 Alternative: Using setup-android.sh

We've created a setup script that guides you through the entire process:

```bash
cd ~/Sites/cloud-sync
./setup-android.sh
```

This interactive script will:
- Check your environment
- Create the `.env` file
- Guide you through service account setup
- Test the configuration

## 🐛 Troubleshooting

### "Service account key file is missing required fields"

Your key file might be corrupted. Re-download it:

```bash
# On your computer
gcloud iam service-accounts keys create ~/firestore-key.json \
  --iam-account=firestore-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### "Firestore API returned 403: CONSUMER_INVALID"

The service account doesn't have permissions. Grant them:

```bash
# On your computer
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:firestore-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Wait 1-2 minutes for IAM changes to propagate
```

### "Firestore database not found"

You need to create a Firestore database:

1. Go to https://console.cloud.google.com/firestore
2. Click "Create Database"
3. Select "Native mode"
4. Choose region (e.g., us-central1)
5. Click "Create"

### "No messages in Firestore"

This is normal if you haven't ingested any IATSE messages yet. To add test messages:

```bash
node scripts/bootstrap-iatse927-thread.js
```

### File path on Android

Termux home is at: `/data/data/com.termux/files/home/`

Your absolute path should be:
```bash
GOOGLE_APPLICATION_CREDENTIALS=/data/data/com.termux/files/home/firestore-key.json
```

## 📚 What This Fixes

The code now supports **three authentication methods** (in order of preference):

1. **Metadata Server** (Cloud Functions/Cloud Run) - automatic
2. **Service Account Key File** (Android/Termux) - `GOOGLE_APPLICATION_CREDENTIALS`
3. **gcloud CLI** (local development) - `gcloud auth login`

This means the same code works everywhere:
- ✅ Google Cloud Functions
- ✅ Android/Termux
- ✅ Local development (with gcloud)
- ✅ Local development (with service account key)

## 🎯 IATSE-Only Mode (Recommended for Android)

If you only care about IATSE 927 sync and don't need portal sources (Rhino, CrewOne), this is the simplest setup:

**Why?**
- No Chromium/Puppeteer required
- Lighter dependencies
- More reliable on Android

**How?**
Just don't set `SCHEDULE_SOURCES` in your `.env`. The script will:
- ✅ Skip portal sources (no Chromium error)
- ✅ Sync IATSE from Firestore
- ✅ Update Google Calendar

## 📞 Need Help?

Run the diagnostic test:
```bash
node test-firestore-auth.js
```

This will show you exactly what's configured and what's missing.

## 📄 Full Documentation

For more details, see:
- `ANDROID_SETUP.md` - Complete Android setup guide
- `IATSE_SYNC_SOLUTION.md` - Cloud Functions setup
- `.env.example` - All available configuration options
