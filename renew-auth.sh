#!/bin/bash

# Script to check and renew Google OAuth token, then update Cloud Function
# This script will:
# 1. Check if local token.json exists and is expired
# 2. Check if Cloud Function token is expired
# 3. Automatically renew if expired (or if --force flag is used)
# 4. Prepare OAuth environment variables
# 5. Update the Cloud Function with the new token

set -e

REGION=${1:-us-central1}
FUNCTION_NAME=${2:-sync-schedule}
SKIP_UPDATE=${3:-false}
FORCE=${4:-false}

TOKEN_PATH="get-schedule/google-calendar/token.json"
CREDENTIALS_PATH="get-schedule/google-calendar/credentials.json"
NEEDS_RENEWAL=false

# Function to check if token is expired
test_token_expired() {
    local token_path=$1
    
    if [ ! -f "$token_path" ]; then
        echo "EXPIRED|Token file does not exist"
        return 0
    fi
    
    # Use node to parse JSON and check expiry
    local result=$(node -e "
        const fs = require('fs');
        try {
            const token = JSON.parse(fs.readFileSync('$token_path', 'utf8'));
            if (!token.expiry_date) {
                console.log('EXPIRED|Token missing expiry_date');
                process.exit(0);
            }
            const expiryDate = new Date(token.expiry_date);
            const now = new Date();
            const buffer = 60 * 60 * 1000; // 1 hour in milliseconds
            if (expiryDate < new Date(now.getTime() + buffer)) {
                console.log('EXPIRED|Token expired on ' + expiryDate.toISOString());
                process.exit(0);
            }
            if (!token.refresh_token) {
                console.log('EXPIRED|Token missing refresh_token');
                process.exit(0);
            }
            console.log('VALID|Token is valid until ' + expiryDate.toISOString());
        } catch (err) {
            console.log('EXPIRED|Error reading token: ' + err.message);
        }
    ")
    
    echo "$result"
}

# Function to check Cloud Function token
test_cloud_function_token_expired() {
    local region=$1
    local function_name=$2
    
    local function_json=$(gcloud functions describe "$function_name" --gen2 --region="$region" --format="json(serviceConfig.environmentVariables)" 2>&1)
    if [ $? -ne 0 ]; then
        echo "EXPIRED|Could not fetch Cloud Function environment variables"
        return 0
    fi
    
    local result=$(node -e "
        try {
            const data = JSON.parse(process.argv[1]);
            const envVars = data.serviceConfig?.environmentVariables;
            if (!envVars || !envVars.GOOGLE_TOKEN) {
                console.log('EXPIRED|Cloud Function missing GOOGLE_TOKEN');
                process.exit(0);
            }
            const token = JSON.parse(envVars.GOOGLE_TOKEN);
            if (!token.expiry_date) {
                console.log('EXPIRED|Cloud Function token missing expiry_date');
                process.exit(0);
            }
            const expiryDate = new Date(token.expiry_date);
            const now = new Date();
            const buffer = 60 * 60 * 1000; // 1 hour
            if (expiryDate < new Date(now.getTime() + buffer)) {
                console.log('EXPIRED|Cloud Function token expired on ' + expiryDate.toISOString());
                process.exit(0);
            }
            if (!token.refresh_token) {
                console.log('EXPIRED|Cloud Function token missing refresh_token');
                process.exit(0);
            }
            console.log('VALID|Cloud Function token is valid until ' + expiryDate.toISOString());
        } catch (err) {
            console.log('EXPIRED|Error checking Cloud Function token: ' + err.message);
        }
    " "$function_json")
    
    echo "$result"
}

echo "Checking Google OAuth Token Status"
echo ""

# Check local token
echo "Checking local token..."
local_result=$(test_token_expired "$TOKEN_PATH")
local_status=$(echo "$local_result" | cut -d'|' -f1)
local_reason=$(echo "$local_result" | cut -d'|' -f2-)

if [ "$local_status" = "EXPIRED" ]; then
    echo "  Local token: EXPIRED or INVALID - $local_reason"
    NEEDS_RENEWAL=true
else
    echo "  Local token: VALID - $local_reason"
fi

echo ""

# Check Cloud Function token
echo "Checking Cloud Function token..."
cloud_result=$(test_cloud_function_token_expired "$REGION" "$FUNCTION_NAME")
cloud_status=$(echo "$cloud_result" | cut -d'|' -f1)
cloud_reason=$(echo "$cloud_result" | cut -d'|' -f2-)

if [ "$cloud_status" = "EXPIRED" ]; then
    echo "  Cloud Function token: EXPIRED or INVALID - $cloud_reason"
    NEEDS_RENEWAL=true
else
    echo "  Cloud Function token: VALID - $cloud_reason"
fi

echo ""

# Determine if renewal is needed
if [ "$FORCE" = "true" ]; then
    echo "Force renewal requested..."
    NEEDS_RENEWAL=true
fi

if [ "$NEEDS_RENEWAL" = "false" ]; then
    echo "All tokens are valid. No renewal needed."
    if [ "$SKIP_UPDATE" = "true" ]; then
        exit 0
    fi
    
    # Even if tokens are valid, update env vars to ensure they're in sync
    echo ""
    echo "Updating environment variables to ensure sync..."
    ./deployment/prepare-oauth-env.sh || echo "Warning: Failed to prepare OAuth environment variables"
    exit 0
fi

# Renewal needed
echo "Token renewal required. Starting renewal process..."
echo ""

# Check if credentials exist
if [ ! -f "$CREDENTIALS_PATH" ]; then
    echo "Error: credentials.json not found at $CREDENTIALS_PATH"
    echo "Please ensure Google OAuth credentials are set up."
    exit 1
fi

# Step 1: Delete old token if it exists
if [ -f "$TOKEN_PATH" ]; then
    echo "Removing old token..."
    rm -f "$TOKEN_PATH"
    echo "Old token removed"
else
    echo "No existing token found, will create new one"
fi

echo ""

# Step 2: Run sync.js to trigger re-authentication
echo "Starting OAuth flow..."
echo "   (A browser window will open for authentication)"
echo ""

if ! node sync.js; then
    echo ""
    echo "Authentication failed"
    exit 1
fi

echo ""
echo "Authentication successful!"

# Verify token was created
if [ ! -f "$TOKEN_PATH" ]; then
    echo ""
    echo "Error: token.json was not created. Authentication may have failed."
    exit 1
fi

# Verify new token is valid
echo ""
echo "Verifying new token..."
new_token_result=$(test_token_expired "$TOKEN_PATH")
new_token_status=$(echo "$new_token_result" | cut -d'|' -f1)
new_token_reason=$(echo "$new_token_result" | cut -d'|' -f2-)

if [ "$new_token_status" = "EXPIRED" ]; then
    echo "Error: New token is invalid - $new_token_reason"
    exit 1
fi
echo "New token is valid - $new_token_reason"

echo ""
echo "Token saved to: $TOKEN_PATH"

if [ "$SKIP_UPDATE" = "true" ]; then
    echo ""
    echo "Skipping Cloud Function update (SKIP_UPDATE=true)"
    echo "   To update manually, run:"
    echo "   ./deployment/prepare-oauth-env.sh"
    echo "   ./deployment/update-env-vars.sh $REGION"
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




