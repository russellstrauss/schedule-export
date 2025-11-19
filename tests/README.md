# Integration Tests

Integration tests for the deployed Cloud Function with email notifications on failure.

## Setup

### Email Configuration (Optional)

**Email notifications are optional.** If you don't configure email credentials, tests will still run and fail appropriately, but you won't receive email notifications.

**Why credentials are needed:**
- SMTP servers require authentication to prevent spam
- Email providers verify you're authorized to send emails
- Without credentials, anyone could send emails (security risk)

**To enable email notifications:**

1. **Gmail (Recommended):**
   - Create an App Password: https://support.google.com/accounts/answer/185833
   - Set environment variables:
   ```bash
   export GMAIL_USER="your-email@gmail.com"
   export GMAIL_APP_PASSWORD="your-app-password"
   ```

2. **Generic SMTP:**
   ```bash
   export SMTP_HOST="smtp.your-provider.com"
   export SMTP_PORT="587"
   export SMTP_USER="your-email@example.com"
   export SMTP_PASSWORD="your-password"
   ```

### Configure Notification Email

```bash
export NOTIFICATION_EMAIL="your-email@gmail.com"  # Where to send notifications
export FUNCTION_URL="https://your-function-url.run.app"  # Optional, has default
```

## Running Tests

```bash
# Run integration tests (will send email on failure)
npm run test:integration

# Or directly
node tests/run-integration-tests.js
```

## What Gets Tested

- ✅ Function responds to HTTP requests
- ✅ Function returns proper JSON structure
- ✅ Function handles CORS preflight requests
- ✅ Function completes within reasonable time
- ✅ Function returns success status

## Email Notifications

When tests fail, you'll receive an email with:
- Test summary (total, passed, failed)
- Details of each failed test
- Function URL and timestamp
- Error messages

## Automation

You can set up automated testing using:

### Cloud Scheduler (Recommended)
Create a Cloud Scheduler job that runs the test script periodically.

### GitHub Actions
Add a workflow that runs tests on schedule or on deployment.

### Cron Job
Set up a local cron job to run tests periodically.

## Troubleshooting

**Email not sending?**
- Check SMTP credentials are set correctly
- For Gmail, make sure you're using an App Password, not your regular password
- Check firewall/network allows SMTP connections

**Tests failing?**
- Verify the function URL is correct
- Check function logs: `gcloud functions logs read sync-schedule --gen2 --region=us-central1`
- Ensure the function is deployed and active

