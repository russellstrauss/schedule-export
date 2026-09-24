#!/bin/bash

# Set up Cloud Scheduler to run the function at midnight
# Make sure the Cloud Function is deployed first

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

PROJECT_ID=${1:-$(gcloud config get-value project 2>/dev/null)}
REGION=${2:-us-central1}
FUNCTION_NAME="sync-schedule"
SCHEDULER_JOB_NAME="sync-schedule-midnight"
TIMEZONE=${3:-America/New_York}

echo "⏰ Setting up Cloud Scheduler job: $SCHEDULER_JOB_NAME"
echo "📦 Project: $PROJECT_ID"
echo "🌍 Region: $REGION"
echo "🕐 Schedule: 0 0 * * * (midnight daily)"
echo "🌎 Timezone: $TIMEZONE"

# Get the function URL
FUNCTION_URL=$(gcloud functions describe $FUNCTION_NAME \
  --gen2 \
  --region=$REGION \
  --format="value(serviceConfig.uri)" 2>/dev/null)

if [ -z "$FUNCTION_URL" ]; then
  echo "❌ Error: Could not find Cloud Function URL. Make sure the function is deployed first."
  exit 1
fi

echo "🔗 Function URL: $FUNCTION_URL"

# Create the scheduler job
gcloud scheduler jobs create http $SCHEDULER_JOB_NAME \
  --location=$REGION \
  --schedule="0 0 * * *" \
  --uri="$FUNCTION_URL" \
  --http-method=GET \
  --time-zone="$TIMEZONE" \
  --description="Run schedule sync at midnight daily" \
  --attempt-deadline=600s

if [ $? -eq 0 ]; then
  echo "✅ Cloud Scheduler job created successfully!"
  echo ""
  echo "📋 Job details:"
  gcloud scheduler jobs describe $SCHEDULER_JOB_NAME --location=$REGION
  echo ""
  echo "🧪 Test the job manually:"
  echo "   gcloud scheduler jobs run $SCHEDULER_JOB_NAME --location=$REGION"
else
  echo "⚠️  Job might already exist. To update it, run:"
  echo "   gcloud scheduler jobs update http $SCHEDULER_JOB_NAME --location=$REGION --schedule=\"0 0 * * *\""
fi

