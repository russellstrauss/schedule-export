#!/bin/bash

# Set up Cloud Scheduler to run tests nightly

REGION=${1:-us-central1}
FUNCTION_NAME="run-tests"
JOB_NAME="nightly-tests"
SCHEDULE=${2:-"0 2 * * *"}  # 2 AM daily

echo "⏰ Setting up Cloud Scheduler for nightly tests..."
echo "Function: $FUNCTION_NAME"
echo "Schedule: $SCHEDULE (cron format)"
echo ""

# Get the function URL
echo "📍 Getting function URL..."
FUNCTION_URL=$(gcloud functions describe $FUNCTION_NAME --gen2 --region=$REGION --format="value(serviceConfig.uri)" 2>&1)

if [ $? -ne 0 ] || [ -z "$FUNCTION_URL" ]; then
  echo "❌ Error: Could not find function URL. Make sure the function is deployed first."
  echo "Run: ./deployment/deploy-test-function.sh"
  exit 1
fi

echo "Function URL: $FUNCTION_URL"
echo ""

# Check if job already exists
gcloud scheduler jobs describe $JOB_NAME --location=$REGION > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "📝 Job already exists. Updating..."
  gcloud scheduler jobs update http $JOB_NAME \
    --location=$REGION \
    --schedule=$SCHEDULE \
    --uri=$FUNCTION_URL \
    --http-method=POST \
    --time-zone="America/New_York"
else
  echo "✨ Creating new scheduler job..."
  gcloud scheduler jobs create http $JOB_NAME \
    --location=$REGION \
    --schedule=$SCHEDULE \
    --uri=$FUNCTION_URL \
    --http-method=POST \
    --time-zone="America/New_York" \
    --description="Run integration tests nightly and send email alerts on failure"
fi

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Scheduler job configured!"
  echo ""
  echo "The tests will run automatically at the scheduled time."
  echo "To test manually, run:"
  echo "  gcloud scheduler jobs run $JOB_NAME --location=$REGION"
else
  echo "❌ Failed to create/update scheduler job"
  exit 1
fi


