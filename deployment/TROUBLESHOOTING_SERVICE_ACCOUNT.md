# Troubleshooting Service Account Setup

## Current Issue: Invalid Service Account Key

If you're seeing errors like "GCLOUD_SERVICE_ACCOUNT_KEY is not valid JSON" with a key length of only 58 characters, the secret is not properly configured.

### Expected Key Format

A valid GCP service account key should be a JSON file with approximately 2,300+ characters containing:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "your-sa@your-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
}
```

### How to Get the Correct Key

#### Step 1: Create or Download Service Account Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **IAM & Admin > Service Accounts**
3. Click on your service account (or create one if needed)
4. Go to **Keys** tab
5. Click **Add Key > Create new key**
6. Choose **JSON** format
7. Click **Create**
8. A file like `your-project-123456-abc123def456.json` will be downloaded

#### Step 2: Verify the Key File

Open the downloaded JSON file in a text editor and verify it contains all the fields shown above.

**Check the file size:**
```bash
ls -lh your-project-123456-abc123def456.json
# Should show ~2-3 KB
```

**Validate the JSON:**
```bash
python3 -m json.tool your-project-123456-abc123def456.json
# Should display formatted JSON without errors
```

#### Step 3: Add to Cursor Dashboard

**Option A: Raw JSON (Recommended)**

1. Open the JSON file in a text editor
2. Select ALL content (Ctrl+A / Cmd+A)
3. Copy (Ctrl+C / Cmd+C)
4. Go to [Cursor Dashboard](https://cursor.com/settings) > Cloud Agents > Secrets
5. Click **Add Secret**
6. Name: `GCLOUD_SERVICE_ACCOUNT_KEY`
7. Value: Paste the JSON (Ctrl+V / Cmd+V)
8. Scope: Select your repository
9. Click **Save**

**Option B: Base64 Encoded**

If copying raw JSON causes issues, base64-encode it first:

**On Linux/Mac:**
```bash
base64 -w 0 your-project-123456-abc123def456.json > encoded-key.txt
cat encoded-key.txt
# Copy the output
```

**On Windows PowerShell:**
```powershell
$bytes = [System.IO.File]::ReadAllBytes("your-project-123456-abc123def456.json")
$encoded = [System.Convert]::ToBase64String($bytes)
$encoded | Out-File encoded-key.txt
Get-Content encoded-key.txt
# Copy the output
```

Then paste the encoded string as the secret value.

### Common Mistakes

❌ **Partial copy** - Only copying part of the JSON file
❌ **Wrong file** - Uploading `credentials.json` (OAuth) instead of service account key
❌ **Extra characters** - Adding newlines, spaces, or quotes around the JSON
❌ **Truncated** - Dashboard truncating very long values (use base64 if this happens)
❌ **Wrong field** - Pasting just the `private_key` field instead of the whole JSON

### Verification After Adding Secret

After adding the secret to Cursor Dashboard, you can verify it in a Cloud Agent:

```bash
# Check if secret is set
[ -n "$GCLOUD_SERVICE_ACCOUNT_KEY" ] && echo "Secret is set (length: ${#GCLOUD_SERVICE_ACCOUNT_KEY})" || echo "Secret not set"

# Should show length > 2000 characters for raw JSON
# Or length > 3000 characters for base64 encoded

# Try to parse as JSON (for raw)
echo "$GCLOUD_SERVICE_ACCOUNT_KEY" | python3 -m json.tool > /dev/null && echo "Valid JSON" || echo "Invalid JSON"

# Try to decode base64 and parse (for base64 encoded)
echo "$GCLOUD_SERVICE_ACCOUNT_KEY" | base64 -d | python3 -m json.tool > /dev/null && echo "Valid base64 JSON" || echo "Not base64 or invalid"
```

### Testing the Setup

Once the correct key is in place:

```bash
cd /workspace
./deployment/setup-gcloud-auth.sh
```

Expected output:
```
🔑 Setting up Google Cloud service account authentication...
📏 Service account key length: 2345 characters
✓ Using raw JSON service account key
📦 Project ID: your-project-id
🔐 Activating service account...
📌 Setting default project...
🔧 Setting up application default credentials...

✅ Authentication successful!
```

### Still Having Issues?

#### Check Secret Scope
- Make sure the secret is enabled for your repository
- Verify repository-scoped secrets override team/user secrets if there's a conflict

#### Check Secret Injection
In the Cloud Agent, run:
```bash
env | grep GCLOUD_SERVICE_ACCOUNT_KEY
```

You should see:
```
GCLOUD_SERVICE_ACCOUNT_KEY=[REDACTED]
```

If it's not listed, the secret isn't being injected. Check:
1. Secret is saved in Cursor Dashboard
2. Secret scope includes your repository
3. Repository is not a public repo with secret injection disabled

#### Regenerate Key
If the key file is corrupted or invalid:
1. Go to GCP Console > IAM & Admin > Service Accounts
2. Find your service account
3. Go to Keys tab
4. Delete the old key
5. Create a new key
6. Download and add to Cursor Dashboard

### Required Permissions

Make sure your service account has these roles (minimum for deployment):

```bash
PROJECT_ID="your-project-id"
SA_EMAIL="your-sa@your-project.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/cloudfunctions.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/cloudscheduler.admin"
```

### Getting Help

If you continue to have issues:

1. **Check the key file size** - Should be 2-3 KB, not bytes
2. **Validate JSON structure** - Use `python3 -m json.tool` or online validators
3. **Try base64 encoding** - Helps avoid copy/paste issues
4. **Check Cursor Dashboard logs** - Look for secret injection errors
5. **Test locally first** - Run `setup-gcloud-auth.sh` locally with the key file

For more details, see:
- [GCLOUD_SERVICE_ACCOUNT_SETUP.md](./GCLOUD_SERVICE_ACCOUNT_SETUP.md)
- [CLOUD_AGENT_DEPLOYMENT.md](./CLOUD_AGENT_DEPLOYMENT.md)
