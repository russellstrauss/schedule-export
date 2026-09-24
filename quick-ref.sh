#!/bin/bash
# Quick Reference: Commands for Android Schedule Sync
# Save this file and run: chmod +x quick-ref.sh && ./quick-ref.sh

cat << 'EOF'

╔═══════════════════════════════════════════════════════════════╗
║         Android Schedule Sync - Quick Reference               ║
╚═══════════════════════════════════════════════════════════════╝

📋 COMMON COMMANDS
─────────────────────────────────────────────────────────────────

  ▸ Run sync
    node sync.js

  ▸ Test Firestore authentication
    node test-firestore-auth.js

  ▸ List IATSE messages
    node scripts/list-iatse927.js

  ▸ Sync only IATSE
    node scripts/sync-iatse927.js

  ▸ Check environment
    cat .env | grep -v PASSWORD | grep -v SECRET | grep -v TOKEN


🔧 INITIAL SETUP (First Time Only)
─────────────────────────────────────────────────────────────────

  1. Install dependencies:
     pkg install nodejs-lts git

  2. Clone repository:
     cd ~/Sites
     git clone <repo-url>
     cd cloud-sync

  3. Run interactive setup:
     ./setup-android.sh

     OR manually create .env:
     nano .env


📄 .ENV TEMPLATE (Minimum Required)
─────────────────────────────────────────────────────────────────

  # Required
  GOOGLE_CLOUD_PROJECT=your-project-id
  GOOGLE_APPLICATION_CREDENTIALS=/data/data/com.termux/files/home/firestore-key.json
  GEMINI_API_KEY=your-gemini-api-key

  # Google Calendar OAuth
  GOOGLE_CLIENT_ID=your-client-id
  GOOGLE_CLIENT_SECRET=your-client-secret
  GOOGLE_REDIRECT_URI=http://localhost
  GOOGLE_TOKEN='{"access_token":"...","refresh_token":"...","token_type":"Bearer","expiry_date":...}'


🔑 SERVICE ACCOUNT KEY SETUP (On Your Computer)
─────────────────────────────────────────────────────────────────

  # Set project
  PROJECT_ID="your-project-id"

  # Create service account
  gcloud iam service-accounts create firestore-sync

  # Grant permissions
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/datastore.user"

  # Create key
  gcloud iam service-accounts keys create ~/firestore-key.json \
    --iam-account=firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com

  # Transfer to Android (via USB, cloud storage, or termux-setup-storage)


🔒 SECURITY
─────────────────────────────────────────────────────────────────

  # Secure key file
  chmod 600 ~/firestore-key.json

  # Secure .env
  chmod 600 .env

  # Check permissions
  ls -l ~/firestore-key.json .env


🐛 TROUBLESHOOTING
─────────────────────────────────────────────────────────────────

  ▸ "Cannot download a binary for the provided platform: android"
    → This is expected. Skip portal sources (Rhino/CrewOne)
    → Remove SCHEDULE_SOURCES from .env for IATSE-only mode

  ▸ "Firestore credentials not available"
    → Check GOOGLE_APPLICATION_CREDENTIALS path is correct
    → Verify firestore-key.json exists and has chmod 600
    → Run: node test-firestore-auth.js

  ▸ "Service account token exchange failed"
    → Verify service account has roles/datastore.user permission
    → Wait 1-2 minutes after granting permissions (IAM propagation)

  ▸ "No messages in Firestore"
    → This is normal if no IATSE messages have been ingested yet
    → Add test messages: node scripts/bootstrap-iatse927-thread.js

  ▸ "Firestore database not found"
    → Create Firestore database at https://console.cloud.google.com/firestore
    → Select Native mode and region (e.g., us-central1)


📚 DOCUMENTATION FILES
─────────────────────────────────────────────────────────────────

  ANDROID_FIRESTORE_FIX.md    Quick fix for Firestore auth error
  ANDROID_SETUP.md            Complete Android setup guide
  .env.example                All available configuration options


🔄 AUTOMATION IDEAS
─────────────────────────────────────────────────────────────────

  ▸ Termux Widget
    mkdir -p ~/.shortcuts
    echo '#!/bin/bash' > ~/.shortcuts/sync.sh
    echo 'cd ~/Sites/cloud-sync && node sync.js' >> ~/.shortcuts/sync.sh
    chmod +x ~/.shortcuts/sync.sh

  ▸ Termux:Boot (auto-run on device boot)
    mkdir -p ~/.termux/boot
    echo '#!/bin/bash' > ~/.termux/boot/sync.sh
    echo 'cd ~/Sites/cloud-sync && node sync.js' >> ~/.termux/boot/sync.sh
    chmod +x ~/.termux/boot/sync.sh

  ▸ Cron-like (using termux-job-scheduler)
    # Requires Termux:Boot app
    termux-job-scheduler -s daily_sync \
      --script ~/Sites/cloud-sync/sync.js \
      --period-ms 86400000


💡 TIPS
─────────────────────────────────────────────────────────────────

  • Use IATSE-only mode (no SCHEDULE_SOURCES) for best Android compatibility
  • Keep firestore-key.json secure - it grants access to your Firestore data
  • Get Gemini API key free at: https://aistudio.google.com/apikey
  • OAuth token can be obtained by running renew-auth.sh on your computer
  • For portal sources (Rhino/CrewOne), consider using Cloud Functions instead


📞 QUICK DIAGNOSTICS
─────────────────────────────────────────────────────────────────

  node test-firestore-auth.js

  This will check:
  • Environment variables
  • Service account key file
  • Project ID resolution
  • Access token retrieval
  • Firestore API connectivity


🌟 IATSE-ONLY MODE (Recommended for Android)
─────────────────────────────────────────────────────────────────

  This is the most reliable setup for Android:

  ✓ No Chromium/Puppeteer required
  ✓ Lighter dependencies
  ✓ No browser automation issues
  ✓ Just IATSE + Firestore + Google Calendar

  Simply don't set SCHEDULE_SOURCES in .env


═══════════════════════════════════════════════════════════════════

EOF
