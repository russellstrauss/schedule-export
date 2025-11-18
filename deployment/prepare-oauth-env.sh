#!/bin/bash

# Helper script to prepare Google OAuth environment variables from local files
# Run this before deploying to extract credentials and token

CREDENTIALS_PATH=${1:-"get-schedule/google-calendar/credentials.json"}
TOKEN_PATH=${2:-"get-schedule/google-calendar/token.json"}

echo "🔐 Preparing Google OAuth environment variables..."

# Check if files exist
if [ ! -f "$CREDENTIALS_PATH" ]; then
  echo "❌ Error: credentials.json not found at $CREDENTIALS_PATH"
  exit 1
fi

if [ ! -f "$TOKEN_PATH" ]; then
  echo "⚠️  Warning: token.json not found at $TOKEN_PATH"
  echo "   Run 'node sync.js' locally first to generate token.json"
  exit 1
fi

# Extract values using jq (if available) or node
if command -v jq &> /dev/null; then
  CLIENT_ID=$(jq -r '.installed.client_id' "$CREDENTIALS_PATH")
  CLIENT_SECRET=$(jq -r '.installed.client_secret' "$CREDENTIALS_PATH")
  REDIRECT_URI=$(jq -r '.installed.redirect_uris[0]' "$CREDENTIALS_PATH")
  TOKEN_JSON=$(cat "$TOKEN_PATH" | jq -c .)
else
  # Fallback to node
  CLIENT_ID=$(node -e "console.log(require('$CREDENTIALS_PATH').installed.client_id)")
  CLIENT_SECRET=$(node -e "console.log(require('$CREDENTIALS_PATH').installed.client_secret)")
  REDIRECT_URI=$(node -e "console.log(require('$CREDENTIALS_PATH').installed.redirect_uris[0])")
  TOKEN_JSON=$(node -e "console.log(JSON.stringify(require('$TOKEN_PATH')))")
fi

# Export environment variables
export GOOGLE_CLIENT_ID="$CLIENT_ID"
export GOOGLE_CLIENT_SECRET="$CLIENT_SECRET"
export GOOGLE_REDIRECT_URI="$REDIRECT_URI"
export GOOGLE_TOKEN="$TOKEN_JSON"

echo "✅ Environment variables set:"
echo "   GOOGLE_CLIENT_ID = $CLIENT_ID"
echo "   GOOGLE_CLIENT_SECRET = [hidden]"
echo "   GOOGLE_REDIRECT_URI = $REDIRECT_URI"
echo "   GOOGLE_TOKEN = [set]"
echo ""
echo "📝 Next step: Run ./deploy-function.sh to deploy"

