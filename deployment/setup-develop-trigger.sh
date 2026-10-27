#!/bin/bash
# Create the Cloud Build trigger that deploys every push to develop.
# Production trigger push-production-schedule-sync is left unchanged.
#
# The trigger is in gen-lang-client-0523900922, region northamerica-northeast2,
# which is separate from the project that hosts the Cloud Function.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEVELOP_TRIGGER_PROJECT="${1:-${DEVELOP_TRIGGER_PROJECT:-gen-lang-client-0523900922}}"
export DEVELOP_TRIGGER_REGION="${2:-${DEVELOP_TRIGGER_REGION:-northamerica-northeast2}}"
exec python3 "$ROOT/deployment/ensure-develop-trigger.py"
