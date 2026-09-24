#!/bin/bash

# Update environment variables for deployed Cloud Function
# This updates variables without redeploying the entire function

# Auto-setup gcloud authentication if running in Cloud Agent with service account key
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "$GCLOUD_SERVICE_ACCOUNT_KEY" ] && [ ! -f "$HOME/.config/gcloud/application_default_credentials.json" ]; then
    echo "🔧 Detected Cloud Agent environment with service account key..."
    if [ -f "$SCRIPT_DIR/setup-gcloud-auth.sh" ]; then
        echo "🔐 Running gcloud authentication setup..."
        bash "$SCRIPT_DIR/setup-gcloud-auth.sh"
        if [ $? -ne 0 ]; then
            echo "❌ Failed to set up gcloud authentication"
            exit 1
        fi
        echo ""
    fi
fi

# Add gcloud to PATH if installed in /tmp (Cloud Agent environment)
if [ -d "/tmp/google-cloud-sdk/bin" ]; then
    export PATH="/tmp/google-cloud-sdk/bin:$PATH"
fi

REGION=${1:-us-central1}
FUNCTION_NAME="sync-schedule"

echo "Updating environment variables for: $FUNCTION_NAME"
echo "Region: $REGION"
echo ""

# Build environment variables
ENV_VARS=""

if [ -n "$RHINO_EMAIL" ]; then
  ENV_VARS="${ENV_VARS}RHINO_EMAIL=${RHINO_EMAIL},"
fi
if [ -n "$RHINO_PASSWORD" ]; then
  ENV_VARS="${ENV_VARS}RHINO_PASSWORD=${RHINO_PASSWORD},"
fi
if [ -n "$SCHEDULE_SOURCES" ]; then
  ENV_VARS="${ENV_VARS}SCHEDULE_SOURCES=${SCHEDULE_SOURCES},"
fi
if [ -n "$CREWONE_EMAIL" ]; then
  ENV_VARS="${ENV_VARS}CREWONE_EMAIL=${CREWONE_EMAIL},"
fi
if [ -n "$CREWONE_PASSWORD" ]; then
  ENV_VARS="${ENV_VARS}CREWONE_PASSWORD=${CREWONE_PASSWORD},"
fi
if [ -n "$CREWONE_LOGIN_URL" ]; then
  ENV_VARS="${ENV_VARS}CREWONE_LOGIN_URL=${CREWONE_LOGIN_URL},"
fi
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  ENV_VARS="${ENV_VARS}GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},"
fi
if [ -n "$GOOGLE_CLIENT_SECRET" ]; then
  ENV_VARS="${ENV_VARS}GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET},"
fi
if [ -n "$GOOGLE_REDIRECT_URI" ]; then
  ENV_VARS="${ENV_VARS}GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI},"
fi
if [ -n "$GOOGLE_TOKEN" ]; then
  ENV_VARS="${ENV_VARS}GOOGLE_TOKEN=${GOOGLE_TOKEN},"
fi

# Remove trailing comma
ENV_VARS=${ENV_VARS%,}

if [ -z "$ENV_VARS" ]; then
  echo "No environment variables found. Set them first."
  exit 1
fi

echo "Updating environment variables..."
gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --region=$REGION \
  --update-env-vars="$ENV_VARS"

echo "Environment variables updated!"


