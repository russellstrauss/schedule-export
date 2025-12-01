#!/bin/bash

# Deploy Cloud Function for running integration tests
# This function runs tests and sends email notifications on failure

PROJECT_ID=${1:-$(gcloud config get-value project)}
REGION=${2:-us-central1}
FUNCTION_NAME="run-tests"

echo "🚀 Deploying Test Function: $FUNCTION_NAME"
echo "📦 Project: $PROJECT_ID"
echo "🌍 Region: $REGION"

# Build environment variables
ENV_VARS=""

if [ -n "$FUNCTION_URL" ]; then
  ENV_VARS="${ENV_VARS}FUNCTION_URL=${FUNCTION_URL},"
fi
if [ -n "$NOTIFICATION_EMAIL" ]; then
  ENV_VARS="${ENV_VARS}NOTIFICATION_EMAIL=${NOTIFICATION_EMAIL},"
fi

# Email credentials
if [ -n "$SMTP_USER" ]; then
  ENV_VARS="${ENV_VARS}SMTP_USER=${SMTP_USER},"
fi
if [ -n "$SMTP_PASSWORD" ]; then
  ENV_VARS="${ENV_VARS}SMTP_PASSWORD=${SMTP_PASSWORD},"
fi
if [ -n "$GMAIL_USER" ]; then
  ENV_VARS="${ENV_VARS}GMAIL_USER=${GMAIL_USER},"
fi
if [ -n "$GMAIL_APP_PASSWORD" ]; then
  ENV_VARS="${ENV_VARS}GMAIL_APP_PASSWORD=${GMAIL_APP_PASSWORD},"
fi

# Remove trailing comma
ENV_VARS=${ENV_VARS%,}

echo "📝 Setting environment variables..."

gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=runTests \
  --trigger-http \
  --allow-unauthenticated \
  --memory=2GB \
  --timeout=600s \
  --max-instances=1 \
  --set-env-vars="$ENV_VARS"

echo "✅ Test function deployed!"
echo ""
echo "📝 Next step: Run ./deployment/setup-test-scheduler.sh to schedule nightly tests"


