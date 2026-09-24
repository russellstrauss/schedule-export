#!/bin/bash
# Setup Google Cloud authentication using service account key from environment variable
# This script is designed for Cloud Agent / CI environments where the service account key
# is provided via the GCLOUD_SERVICE_ACCOUNT_KEY environment variable

set -e

echo "🔑 Setting up Google Cloud service account authentication..."

# Check if GCLOUD_SERVICE_ACCOUNT_KEY is set
if [ -z "$GCLOUD_SERVICE_ACCOUNT_KEY" ]; then
    echo "❌ Error: GCLOUD_SERVICE_ACCOUNT_KEY environment variable is not set"
    echo ""
    echo "To fix this:"
    echo "1. Go to Cursor Dashboard (Cloud Agents > Secrets)"
    echo "2. Add GCLOUD_SERVICE_ACCOUNT_KEY secret with your service account JSON key"
    echo "3. Make sure it's enabled for this repository"
    exit 1
fi

# Create a temporary file for the service account key
KEY_FILE="/tmp/gcloud-service-account-key.json"

echo "📏 Service account key length: ${#GCLOUD_SERVICE_ACCOUNT_KEY} characters"

# Try to decode as base64 first, fallback to raw
if echo "$GCLOUD_SERVICE_ACCOUNT_KEY" | base64 -d > "$KEY_FILE" 2>/dev/null && \
   [ -s "$KEY_FILE" ] && \
   python3 -m json.tool "$KEY_FILE" > /dev/null 2>&1; then
    echo "✓ Decoded base64-encoded service account key"
else
    # Not base64 or decode failed, try as raw JSON
    echo "$GCLOUD_SERVICE_ACCOUNT_KEY" > "$KEY_FILE"
    
    # Check if file has content
    if [ ! -s "$KEY_FILE" ]; then
        echo "❌ Error: GCLOUD_SERVICE_ACCOUNT_KEY appears to be empty"
        echo ""
        echo "This might happen if:"
        echo "  - The secret is not properly set in Cursor Dashboard"
        echo "  - The secret value was incorrectly formatted when added"
        echo ""
        echo "Please check that the secret contains a valid GCP service account JSON key."
        rm -f "$KEY_FILE"
        exit 1
    fi
    
    if ! python3 -m json.tool "$KEY_FILE" > /dev/null 2>&1; then
        echo "❌ Error: GCLOUD_SERVICE_ACCOUNT_KEY is not valid JSON"
        echo ""
        echo "Expected format: A GCP service account key JSON file with fields like:"
        echo '  {"type": "service_account", "project_id": "...", "private_key": "...", ...}'
        echo ""
        echo "The key can be either:"
        echo "  1. Raw JSON (recommended)"
        echo "  2. Base64-encoded JSON"
        rm -f "$KEY_FILE"
        exit 1
    fi
    echo "✓ Using raw JSON service account key"
fi

# Extract project ID from the service account key
PROJECT_ID=$(python3 -c "import json; print(json.load(open('$KEY_FILE'))['project_id'])")
if [ -z "$PROJECT_ID" ]; then
    echo "❌ Error: Could not extract project_id from service account key"
    rm -f "$KEY_FILE"
    exit 1
fi

echo "📦 Project ID: $PROJECT_ID"

# Add gcloud to PATH if not already there
if ! command -v gcloud &> /dev/null; then
    if [ -d "/tmp/google-cloud-sdk/bin" ]; then
        export PATH="/tmp/google-cloud-sdk/bin:$PATH"
    else
        echo "❌ Error: gcloud CLI not found. Please install it first."
        rm -f "$KEY_FILE"
        exit 1
    fi
fi

# Activate the service account
echo "🔐 Activating service account..."
gcloud auth activate-service-account --key-file="$KEY_FILE" --quiet

# Set the default project
echo "📌 Setting default project..."
gcloud config set project "$PROJECT_ID" --quiet

# Set application default credentials (for libraries like @google-cloud/firestore)
echo "🔧 Setting up application default credentials..."
export GOOGLE_APPLICATION_CREDENTIALS="$KEY_FILE"

# Verify authentication
echo ""
echo "✅ Authentication successful!"
echo ""
echo "📊 Current configuration:"
gcloud config list

echo ""
echo "👤 Active account:"
gcloud auth list

echo ""
echo "📝 To use this authentication in your shell session, run:"
echo "   export PATH=\"/tmp/google-cloud-sdk/bin:\$PATH\""
echo "   export GOOGLE_APPLICATION_CREDENTIALS=\"$KEY_FILE\""
echo ""
echo "⚠️  Note: The service account key is stored at $KEY_FILE"
echo "   This is safe for Cloud Agent environments but should not be committed to git."
