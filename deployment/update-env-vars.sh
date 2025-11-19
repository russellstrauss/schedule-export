#!/bin/bash

# Update environment variables for deployed Cloud Function
# This updates variables without redeploying the entire function

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


