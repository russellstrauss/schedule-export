# Android OAuth Setup - Two Options

You have **two ways** to set up Google Calendar OAuth on Android:

## Option 1: Use JSON Files (Recommended - Easier)

Copy the OAuth credential files from your computer to Android.

### Steps:

1. **On your computer**, locate these files:
   ```
   get-schedule/google-calendar/credentials.json
   get-schedule/google-calendar/token.json
   ```

2. **Transfer both files to Android** (via USB, cloud storage, etc.)

3. **In Termux**, place them in the same location:
   ```bash
   cd ~/Sites/cloud-sync  # your project directory
   mkdir -p get-schedule/google-calendar/
   
   # Copy the files here (however you transferred them)
   # They should be at:
   # ~/Sites/cloud-sync/get-schedule/google-calendar/credentials.json
   # ~/Sites/cloud-sync/get-schedule/google-calendar/token.json
   ```

4. **Your `.env` does NOT need OAuth variables**:
   ```bash
   # Only need these:
   GOOGLE_CLOUD_PROJECT=your-project-id
   GOOGLE_APPLICATION_CREDENTIALS=/data/data/com.termux/files/home/firestore-key.json
   GEMINI_API_KEY=your-gemini-api-key
   
   # OAuth will be read from JSON files, not .env
   ```

5. **Done!** Run `node sync.js`

### ✅ Pros:
- Simpler - just copy 2 files
- Tokens auto-refresh and save
- Same setup as your computer

### ❌ Cons:
- Need to transfer files to Android
- Files must be in exact location

---

## Option 2: Use Environment Variables

Extract OAuth credentials from JSON files and put them in `.env`.

### Steps:

1. **On your computer**, extract the values:
   ```bash
   # Get Client ID and Secret
   cat get-schedule/google-calendar/credentials.json | node -e "
   const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
   console.log('GOOGLE_CLIENT_ID=' + data.installed.client_id);
   console.log('GOOGLE_CLIENT_SECRET=' + data.installed.client_secret);
   console.log('GOOGLE_REDIRECT_URI=' + data.installed.redirect_uris[0]);
   "
   
   # Get Token
   echo "GOOGLE_TOKEN='$(cat get-schedule/google-calendar/token.json)'"
   ```

2. **Copy the output and add to Android `.env`**:
   ```bash
   # In Termux
   nano .env
   ```
   
   Add:
   ```bash
   GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-abc123xyz
   GOOGLE_REDIRECT_URI=http://localhost:3000
   GOOGLE_TOKEN='{"access_token":"ya29...","refresh_token":"1//...","token_type":"Bearer","expiry_date":1234567890}'
   ```

### ✅ Pros:
- No files to transfer
- Everything in one `.env` file

### ❌ Cons:
- More complex setup
- Token won't auto-save when refreshed (but it will still work - just refreshes in memory)
- Need to manually extract values

---

## 🤔 Which Option Should I Use?

### Use **Option 1 (JSON Files)** if:
- ✅ You can easily transfer files to Android
- ✅ You want the simplest setup
- ✅ You want tokens to auto-refresh and persist

### Use **Option 2 (Environment Variables)** if:
- ✅ You can't easily transfer files
- ✅ You prefer everything in `.env`
- ✅ You don't mind extracting values manually

**My recommendation: Option 1** (copy the JSON files)

---

## 📁 Where to Find the JSON Files

On your computer, the files are at:
```
your-project/
└── get-schedule/
    └── google-calendar/
        ├── credentials.json  ← OAuth client credentials
        └── token.json        ← Your refresh token
```

If these files don't exist on your computer:
1. You haven't set up OAuth yet
2. Run: `node sync.js` on your computer first
3. It will guide you through OAuth setup
4. Files will be created automatically

---

## 🔄 Do I Need to Renew Tokens?

**Option 1 (JSON files):**
- Tokens auto-refresh when needed
- The refreshed token is saved back to `token.json`
- You rarely need to do anything

**Option 2 (Environment variables):**
- Tokens auto-refresh in memory during sync
- But the refreshed token is NOT saved back to `.env`
- This is fine - the old token still has the refresh_token
- If sync fails, you may need to re-extract the token

---

## 🚨 Troubleshooting

### "Credentials file not found"
→ You're missing `credentials.json`
→ Use Option 1 and copy the file, OR use Option 2 with env vars

### "Missing GOOGLE_TOKEN environment variable"
→ You're in cloud runtime mode
→ Add OAuth vars to `.env`, OR copy JSON files

### "Invalid GOOGLE_TOKEN environment variable"
→ The JSON in `.env` is malformed
→ Make sure it's a valid JSON string in single quotes

### Token expired
→ If you have a refresh_token, it will auto-refresh
→ If not, you need to re-authenticate (run `node sync.js` on your computer)

---

## 💡 Summary

| Aspect | Option 1: JSON Files | Option 2: Env Vars |
|--------|---------------------|-------------------|
| Setup Complexity | ⭐⭐ Easy | ⭐⭐⭐ Moderate |
| File Transfer Required | ✅ Yes (2 files) | ❌ No |
| Token Auto-Save | ✅ Yes | ❌ No (memory only) |
| Everything in .env | ❌ No | ✅ Yes |
| **Recommended** | **✅ For most users** | For advanced users |
