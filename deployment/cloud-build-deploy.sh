#!/bin/bash
# Deploy the schedule function from Cloud Build.
#
# develop -> sync-schedule-develop (separate testing URL)
# any other branch, including main -> sync-schedule
#
# The first develop deploy copies plain environment variables and Secret
# Manager bindings from production. Later deploys leave that function's
# environment in place. Develop is not added to Cloud Scheduler.

set -euo pipefail

PROJECT="${1:-}"
REGION="${2:-us-central1}"
if [ -z "$PROJECT" ]; then
  echo "Usage: deployment/cloud-build-deploy.sh PROJECT_ID [REGION]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FUNCTION_NAME="$(bash "$ROOT/deployment/deploy-target.sh" "${BRANCH_NAME:-}")"
PROD_FUNCTION="sync-schedule"

echo "Branch: ${BRANCH_NAME:-<manual>}"
echo "Function: ${FUNCTION_NAME}"
echo "Project: ${PROJECT}"
echo "Region: ${REGION}"

BASE_DEPLOY=(
  gcloud functions deploy "$FUNCTION_NAME"
  --project="$PROJECT"
  --gen2
  --runtime=nodejs24
  --region="$REGION"
  --source=.
  --entry-point=syncSchedule
  --trigger-http
  --allow-unauthenticated
  --memory=1GB
  --timeout=600s
  --max-instances=2
)
DEPLOY=("${BASE_DEPLOY[@]}")
SEEDED=false

if [ "$FUNCTION_NAME" != "$PROD_FUNCTION" ]; then
  TARGET_JSON="$(mktemp)"
  PROD_JSON="$(mktemp)"
  ENV_FILE="$(mktemp)"
  cleanup() {
    rm -f "$TARGET_JSON" "$PROD_JSON" "$ENV_FILE"
  }
  trap cleanup EXIT

  set +e
  # stdout JSON goes to the file; stderr is captured for NOT_FOUND detection.
  target_err="$(gcloud functions describe "$FUNCTION_NAME" \
    --gen2 \
    --project="$PROJECT" \
    --region="$REGION" \
    --format=json 2>&1 >"$TARGET_JSON")"
  target_status=$?
  set -e

  seed=false
  if [ "$target_status" -ne 0 ]; then
    if grep -q "NOT_FOUND" <<<"$target_err"; then
      echo "{}" >"$TARGET_JSON"
      seed=true
    else
      echo "Could not read ${FUNCTION_NAME}. Deploying without changing its environment variables."
    fi
  else
    seed=true
  fi

  if [ "$seed" = true ]; then
    if ! command -v python3 >/dev/null 2>&1; then
      echo "python3 is not available. Deploying ${FUNCTION_NAME} without copying environment variables."
    else
      set +e
      gcloud functions describe "$PROD_FUNCTION" \
        --gen2 \
        --project="$PROJECT" \
        --region="$REGION" \
        --format=json >"$PROD_JSON" 2>/dev/null
      prod_status=$?
      set -e
      if [ "$prod_status" -ne 0 ]; then
        echo "Could not read ${PROD_FUNCTION} runtime config. ${FUNCTION_NAME} will deploy without copied environment variables."
      else
        plan="$(python3 "$ROOT/deployment/develop-runtime-config.py" \
          --prod-json "$PROD_JSON" \
          --target-json "$TARGET_JSON" \
          --env-file "$ENV_FILE")"
        action="$(awk '{print $1}' <<<"$plan")"
        if [ "$action" = "seed" ]; then
          env_count="$(awk '{print $2}' <<<"$plan")"
          secrets="$(awk '{print $3}' <<<"$plan")"
          echo "Seeding ${FUNCTION_NAME} from ${PROD_FUNCTION} (${env_count} plain env vars)."
          if [ "$env_count" != "0" ]; then
            DEPLOY+=(--env-vars-file="$ENV_FILE")
          fi
          if [ -n "$secrets" ] && [ "$secrets" != "-" ]; then
            secret_count="$(awk -F, '{print NF}' <<<"$secrets")"
            echo "Copying ${secret_count} Secret Manager bindings from ${PROD_FUNCTION}."
            DEPLOY+=(--set-secrets="$secrets")
          fi
          if [ "$env_count" != "0" ] || { [ -n "$secrets" ] && [ "$secrets" != "-" ]; }; then
            SEEDED=true
          fi
        else
          echo "Keeping existing environment variables on ${FUNCTION_NAME}."
        fi
      fi
    fi
  fi
fi

set +e
"${DEPLOY[@]}"
deploy_status=$?
set -e
if [ "$deploy_status" -ne 0 ]; then
  if [ "$SEEDED" = true ]; then
    echo "Deploy with copied runtime config failed. Retrying without environment changes so the testing URL can still be created."
    "${BASE_DEPLOY[@]}"
  else
    exit "$deploy_status"
  fi
fi

URL="$(gcloud functions describe "$FUNCTION_NAME" \
  --gen2 \
  --project="$PROJECT" \
  --region="$REGION" \
  --format='value(serviceConfig.uri)')"
echo "Function URL: ${URL}"
if [ "$FUNCTION_NAME" != "$PROD_FUNCTION" ]; then
  echo "Health check (does not sync): ${URL}?mode=health"
  echo "A request without mode=health runs a real calendar sync on the shared calendar."
  echo "Develop is not on the midnight schedule."
fi
