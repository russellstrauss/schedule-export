#!/bin/bash
# Map a git branch to the Cloud Function that should receive the deploy.
# develop publishes a separate testing URL. Every other branch, including main,
# stays on the production function.

branch="${1:-}"
if [ "$branch" = "develop" ]; then
  printf '%s\n' "sync-schedule-develop"
else
  printf '%s\n' "sync-schedule"
fi
