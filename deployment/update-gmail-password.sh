#!/bin/bash

# Update GMAIL_APP_PASSWORD in local .env file

if [ -z "$1" ]; then
  echo "Usage: $0 <app-password>"
  echo "Example: $0 abcd efgh ijkl mnop"
  exit 1
fi

APP_PASSWORD="$1"
ENV_FILE="$(dirname "$0")/../.env"

# Create .env if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
  touch "$ENV_FILE"
fi

# Remove existing GMAIL_APP_PASSWORD line and add new one
grep -v "^GMAIL_APP_PASSWORD=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
echo "GMAIL_APP_PASSWORD=$APP_PASSWORD" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"

echo "✅ Updated GMAIL_APP_PASSWORD in .env file"
echo ""
echo "To update the server-side environment variable after deploying:"
echo "  gcloud functions deploy run-tests --gen2 --region=us-central1 --update-env-vars=\"GMAIL_APP_PASSWORD=$APP_PASSWORD\""


