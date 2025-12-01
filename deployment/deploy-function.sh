#!/bin/bash

# Deploy Cloud Function for schedule sync
# Make sure you're authenticated: gcloud auth login
# Set your project: gcloud config set project YOUR_PROJECT_ID

PROJECT_ID=${1:-$(gcloud config get-value project)}
REGION=${2:-us-central1}
FUNCTION_NAME="sync-schedule"

echo "🚀 Deploying Cloud Function: $FUNCTION_NAME"
echo "📦 Project: $PROJECT_ID"
echo "🌍 Region: $REGION"

# Build environment variables
ENV_VARS="RHINO_EMAIL=${RHINO_EMAIL},RHINO_PASSWORD=${RHINO_PASSWORD}"

# Add Google OAuth env vars if they exist
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  ENV_VARS="${ENV_VARS},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"
fi
if [ -n "$GOOGLE_CLIENT_SECRET" ]; then
  ENV_VARS="${ENV_VARS},GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}"
fi
if [ -n "$GOOGLE_REDIRECT_URI" ]; then
  ENV_VARS="${ENV_VARS},GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}"
fi
if [ -n "$GOOGLE_TOKEN" ]; then
  ENV_VARS="${ENV_VARS},GOOGLE_TOKEN=${GOOGLE_TOKEN}"
fi

echo "📝 Setting environment variables..."
echo "   (Make sure RHINO_EMAIL, RHINO_PASSWORD, and Google OAuth vars are set)"

gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=syncSchedule \
  --trigger-http \
  --allow-unauthenticated \
  --memory=1GB \
  --timeout=540s \
  --max-instances=1 \
  --set-env-vars="$ENV_VARS"

echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Run ./setup-scheduler.sh to create the Cloud Scheduler job"
echo "2. The function URL will be displayed above"

