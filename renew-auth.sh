#!/bin/bash

# Script to renew Google OAuth token and update Cloud Function
# This script will:
# 1. Delete the old token.json (if it exists)
# 2. Run sync.js to trigger re-authentication
# 3. Prepare OAuth environment variables
# 4. Update the Cloud Function with the new token

set -e

REGION=${1:-us-central1}
FUNCTION_NAME=${2:-sync-schedule}
SKIP_UPDATE=${3:-false}

TOKEN_PATH="get-schedule/google-calendar/token.json"

echo "🔄 Renewing Google OAuth Token"
echo ""

# Step 1: Delete old token if it exists
if [ -f "$TOKEN_PATH" ]; then
    echo "🗑️  Removing old token..."
    rm -f "$TOKEN_PATH"
    echo "✅ Old token removed"
else
    echo "ℹ️  No existing token found, will create new one"
fi

echo ""

# Step 2: Run sync.js to trigger re-authentication
echo "🔐 Starting OAuth flow..."
echo "   (A browser window will open for authentication)"
echo ""

if ! node sync.js; then
    echo ""
    echo "❌ Authentication failed"
    exit 1
fi

echo ""
echo "✅ Authentication successful!"

# Verify token was created
if [ ! -f "$TOKEN_PATH" ]; then
    echo ""
    echo "❌ Error: token.json was not created. Authentication may have failed."
    exit 1
fi

echo ""
echo "📝 Token saved to: $TOKEN_PATH"

if [ "$SKIP_UPDATE" = "true" ]; then
    echo ""
    echo "⏭️  Skipping Cloud Function update (SKIP_UPDATE=true)"
    echo "   To update manually, run:"
    echo "   ./deployment/prepare-oauth-env.sh"
    echo "   ./deployment/update-env-vars.sh"
    exit 0
fi

echo ""

# Step 3: Prepare OAuth environment variables
echo "📦 Preparing OAuth environment variables..."
if ! ./deployment/prepare-oauth-env.sh; then
    echo ""
    echo "❌ Failed to prepare OAuth environment variables"
    exit 1
fi

echo ""

# Step 4: Update Cloud Function
echo "☁️  Updating Cloud Function environment variables..."
echo "   Function: $FUNCTION_NAME"
echo "   Region: $REGION"
echo ""

if ! ./deployment/update-env-vars.sh "$REGION"; then
    echo ""
    echo "❌ Failed to update Cloud Function"
    echo ""
    echo "💡 You can update manually by running:"
    echo "   ./deployment/update-env-vars.sh $REGION"
    exit 1
fi

echo ""
echo "✅ Token renewal complete!"
echo "   The Cloud Function has been updated with the new token."



