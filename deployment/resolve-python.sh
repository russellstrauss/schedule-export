#!/bin/bash
# Print a Python 3 interpreter.
# The Cloud Build cloud-sdk image keeps gcloud's Python and removes python3
# from PATH. A build step that calls python3 exits before it can deploy.

set -euo pipefail

if command -v python3 >/dev/null 2>&1; then
  command -v python3
  exit 0
fi

if command -v gcloud >/dev/null 2>&1; then
  bundled="$(gcloud info --format='value(basic.python_location)' 2>/dev/null || true)"
  if [ -n "$bundled" ] && [ -x "$bundled" ]; then
    printf '%s\n' "$bundled"
    exit 0
  fi
fi

echo "python3 was not found on PATH and gcloud has no bundled Python." >&2
exit 1
