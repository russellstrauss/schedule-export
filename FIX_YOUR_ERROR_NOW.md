# Fix Your Firestore Error Right Now

You're seeing this error:
```
⚠️  Skipping iatse927: Firestore credentials not available 
   (Firestore auth failed. Run: gcloud auth login && gcloud auth application-default login)
❌ Local sync failed: Error: No schedule sources ran.
```

**The problem:** `gcloud` doesn't work on Android. You need a service account key file instead.

## 🎯 Solution (10 minutes)

### On Your Computer

Open a terminal and run these commands **exactly as shown** (replace `your-project-id` with your actual GCP project ID):

```bash
# 1. Set your project ID
export PROJECT_ID="your-project-id"

# 2. Create service account
gcloud iam service-accounts create firestore-sync \
  --display-name="Firestore Sync Service Account" \
  --project=$PROJECT_ID

# 3. Grant Firestore permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# 4. Create and download the key file
gcloud iam service-accounts keys create ~/firestore-key.json \
  --iam-account=firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com

# 5. Verify the file was created
ls -lh ~/firestore-key.json
```

You should see: `-rw------- ... firestore-key.json` (about 2-3 KB)

### Transfer Key to Android

**Method 1: USB Cable**
1. Connect your Android device to your computer
2. Copy `~/firestore-key.json` to your device's Downloads folder
3. In Termux, run:
   ```bash
   termux-setup-storage  # Grant storage permission
   cp ~/storage/downloads/firestore-key.json ~/firestore-key.json
   chmod 600 ~/firestore-key.json
   ```

**Method 2: Cloud Storage (if no USB cable)**
1. **On your computer:**
   ```bash
   # Upload to a temporary location (Google Drive, Dropbox, etc.)
   # Or use this one-liner to display the file contents:
   cat ~/firestore-key.json | base64
   # Copy the output
   ```

2. **On Android in Termux:**
   ```bash
   # Paste the base64 content and decode:
   cat > ~/firestore-key-encoded.txt
   # Paste the base64 text, then press Ctrl+D
   
   base64 -d ~/firestore-key-encoded.txt > ~/firestore-key.json
   chmod 600 ~/firestore-key.json
   rm ~/firestore-key-encoded.txt
   ```

### On Android in Termux

```bash
# 1. Navigate to your project
cd ~/Sites/cloud-sync  # or wherever your project is

# 2. Create or edit .env file
nano .env
```

Add these lines (replace with your actual values):

```bash
# Required for Firestore
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/data/data/com.termux/files/home/firestore-key.json

# Required for IATSE (get from https://aistudio.google.com/apikey)
GEMINI_API_KEY=your-gemini-api-key-here

# Required for Google Calendar (get from renew-auth.sh on your computer)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost
GOOGLE_TOKEN='{"access_token":"ya29...","refresh_token":"1//...","token_type":"Bearer","expiry_date":...}'
```

Save and exit (Ctrl+X, then Y, then Enter).

```bash
# 3. Secure the files
chmod 600 .env
chmod 600 ~/firestore-key.json

# 4. Install dependencies (if not already done)
npm install

# 5. Test authentication
node test-firestore-auth.js
```

You should see:
```
✅ Service Account Key File:
   Exists: ✅
✅ Project ID: your-project-id
✅ Token obtained: ✅
✅ HTTP Status: 200 ✅
✅ SUCCESS! Firestore authentication is working.
```

### Run the Sync

```bash
node sync.js
```

Expected output:
```
🌐 Fetching schedule from iatse927...
  📅 [iatse927] Event Title (2026-XX-XX 09:00)
✅ Schedule sync completed locally.
```

## ✅ You're Done!

The error should be gone. The sync now works on Android without `gcloud` CLI.

## 🐛 Still Having Issues?

### "Service account key file is missing required fields"
→ The file might be corrupted. Re-download it from your computer.

### "HTTP Status: 403 ❌"
→ The service account needs permissions. Wait 1-2 minutes after granting the role, then try again.

### "Firestore database not found"
→ Create a Firestore database at https://console.cloud.google.com/firestore
   - Select "Native mode"
   - Choose region: us-central1
   - Click "Create"

### "No messages in Firestore"
→ This is normal if you haven't ingested IATSE messages yet. The sync will work once messages are added.

### "Cannot download a binary for the provided platform: android"
→ This is expected and harmless. It's trying to download Chromium for portal sources (Rhino/CrewOne).
→ You can ignore it if you're only using IATSE. The sync will skip portal sources and use IATSE.

## 📖 Need More Help?

- Run diagnostics: `node test-firestore-auth.js`
- Read full guide: `cat ANDROID_FIRESTORE_FIX.md`
- Quick reference: `./quick-ref.sh`
- Detailed setup: `cat ANDROID_SETUP.md`

## 🔐 Security Reminder

Your `firestore-key.json` file is **sensitive**. It grants access to your Firestore database.

- ✅ Keep it private (chmod 600)
- ✅ Never commit it to git
- ✅ Don't share it
- ✅ Delete any temporary cloud storage uploads after transferring

## 💡 What Changed?

The code now supports **three authentication methods**:

1. **Metadata Server** (Cloud Functions) - automatic ✅
2. **Service Account Key** (Android) - what you just set up ✅
3. **gcloud CLI** (local dev) - fallback ✅

This makes your sync work everywhere:
- ✅ On your Android device (Termux)
- ✅ In Google Cloud Functions
- ✅ On your computer (with or without gcloud)

---

**TL;DR:** Create a service account key on your computer, transfer it to Android, add to `.env`, done! 🎉
