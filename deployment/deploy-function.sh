#!/bin/bash

# Deploy Cloud Function for schedule sync
# Make sure you're authenticated: gcloud auth login
# Set your project: gcloud config set project YOUR_PROJECT_ID
# This script automatically checks and renews tokens if needed before deploying

PROJECT_ID=${1:-$(gcloud config get-value project)}
REGION=${2:-us-central1}
FUNCTION_NAME="sync-schedule"
SKIP_TOKEN_CHECK=${3:-false}

echo "🚀 Deploying Cloud Function: $FUNCTION_NAME"
echo "📦 Project: $PROJECT_ID"
echo "🌍 Region: $REGION"
echo ""

# Step 1: Check and renew token if needed (unless skipped)
if [ "$SKIP_TOKEN_CHECK" != "true" ]; then
    echo "Step 1: Checking token status and renewing if needed..."
    echo ""
    
    RENEW_AUTH_SCRIPT="$(dirname "$0")/../renew-auth.sh"
    if [ -f "$RENEW_AUTH_SCRIPT" ]; then
        # Run renew-auth.sh with SkipUpdate flag (we'll update env vars during deployment)
        bash "$RENEW_AUTH_SCRIPT" "$REGION" "$FUNCTION_NAME" "true"
        if [ $? -ne 0 ]; then
            echo "⚠️  Warning: Token renewal check failed, but continuing with deployment..."
        fi
        echo ""
    else
        echo "⚠️  Warning: renew-auth.sh not found. Skipping token check."
        echo ""
    fi
fi

# Step 2: Build environment variables
echo "Step 2: Preparing environment variables..."
ENV_VARS="RHINO_EMAIL=${RHINO_EMAIL},RHINO_PASSWORD=${RHINO_PASSWORD}"
if [ -n "$SCHEDULE_SOURCES" ]; then
  ENV_VARS="${ENV_VARS},SCHEDULE_SOURCES=${SCHEDULE_SOURCES}"
fi
if [ -n "$CREWONE_EMAIL" ]; then
  ENV_VARS="${ENV_VARS},CREWONE_EMAIL=${CREWONE_EMAIL}"
fi
if [ -n "$CREWONE_PASSWORD" ]; then
  ENV_VARS="${ENV_VARS},CREWONE_PASSWORD=${CREWONE_PASSWORD}"
fi
if [ -n "$CREWONE_LOGIN_URL" ]; then
  ENV_VARS="${ENV_VARS},CREWONE_LOGIN_URL=${CREWONE_LOGIN_URL}"
fi

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
if [ -n "$IATSE_ALLOWED_PHONE" ]; then
  ENV_VARS="${ENV_VARS},IATSE_ALLOWED_PHONE=${IATSE_ALLOWED_PHONE}"
fi
if [ -n "$GEMINI_API_KEY" ]; then
  ENV_VARS="${ENV_VARS},GEMINI_API_KEY=${GEMINI_API_KEY}"
fi
if [ -n "$GEMINI_MODEL" ]; then
  ENV_VARS="${ENV_VARS},GEMINI_MODEL=${GEMINI_MODEL}"
fi

echo "   (RHINO_*, optional CREWONE_* and SCHEDULE_SOURCES, IATSE_ALLOWED_PHONE, GEMINI_*, plus Google OAuth vars)"

# Step 3: Deploy the function
echo ""
echo "Step 3: Deploying Cloud Function..."
gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=syncSchedule \
  --trigger-http \
  --allow-unauthenticated \
  --memory=1GB \
  --timeout=600s \
  --max-instances=1 \
  --set-env-vars="$ENV_VARS"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment complete!"
    
    # Step 4: Ensure token is up to date (in case renew-auth updated it)
    if [ "$SKIP_TOKEN_CHECK" != "true" ]; then
        echo ""
        echo "Step 4: Ensuring token is up to date..."
        RENEW_AUTH_SCRIPT="$(dirname "$0")/../renew-auth.sh"
        if [ -f "$RENEW_AUTH_SCRIPT" ]; then
            # Run renew-auth without SkipUpdate to update env vars if token was renewed
            bash "$RENEW_AUTH_SCRIPT" "$REGION" "$FUNCTION_NAME" "false"
            if [ $? -ne 0 ]; then
                echo "⚠️  Warning: Token update failed, but deployment succeeded."
            fi
        fi
    fi
    
    echo ""
    echo "📝 Next steps:"
    echo "1. Run ./setup-scheduler.sh to create the Cloud Scheduler job"
    echo "2. The function URL will be displayed above"
else
    echo ""
    echo "❌ Deployment failed!"
    exit 1
fi

