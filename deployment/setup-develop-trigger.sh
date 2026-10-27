#!/bin/bash
# Create the Cloud Build trigger that publishes the develop branch.
# The production trigger is left unchanged.
#
# If the existing trigger already matches develop (for example branch ".*"),
# this is a no-op: cloudbuild.yaml chooses the function from BRANCH_NAME.
# If the existing trigger matches only main, a second trigger is imported
# with the same repository settings and branch filter ^develop$.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${1:-}"
if [ -z "$PROJECT" ]; then
  PROJECT="$(python3 - "$ROOT/cloudbuild.yaml" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r"cloud-build-deploy\.sh\s*\n\s*-\s+(\S+)", text)
if not match:
    match = re.search(r"--project(?:=|\s+)(\S+)", text)
if not match:
    raise SystemExit("cloudbuild.yaml has no project id")
print(match.group(1))
PY
)"
fi

export DEVELOP_TRIGGER_PROJECT="$PROJECT"
python3 - "$ROOT" <<'PY'
import json
import os
import re
import subprocess
import sys
import tempfile

project = os.environ["DEVELOP_TRIGGER_PROJECT"]
regions = ["global", "us-central1"]

def run(args):
    return subprocess.run(args, text=True, capture_output=True)

def matches(pattern, branch):
    if not pattern:
        return False
    try:
        return re.fullmatch(pattern, branch) is not None
    except re.error:
        return pattern.strip("^$") == branch

def branch_patterns(trigger):
    patterns = []
    github = trigger.get("github") or {}
    push = github.get("push") or {}
    if push.get("branch"):
        patterns.append(push["branch"])
    event = trigger.get("repositoryEventConfig") or {}
    event_push = event.get("push") or {}
    if event_push.get("branch"):
        patterns.append(event_push["branch"])
    template = trigger.get("triggerTemplate") or {}
    if template.get("branchName"):
        patterns.append(template["branchName"])
    return patterns

def uses_cloudbuild(trigger):
    if trigger.get("filename") == "cloudbuild.yaml":
        return True
    git_file = trigger.get("gitFileSource") or {}
    return git_file.get("path") == "cloudbuild.yaml"

def set_branch(trigger, pattern):
    if trigger.get("github", {}).get("push") is not None or trigger.get("github"):
        trigger.setdefault("github", {}).setdefault("push", {})["branch"] = pattern
    if trigger.get("repositoryEventConfig", {}).get("push") is not None or trigger.get("repositoryEventConfig"):
        trigger.setdefault("repositoryEventConfig", {}).setdefault("push", {})["branch"] = pattern
    if trigger.get("triggerTemplate"):
        trigger["triggerTemplate"]["branchName"] = pattern

found = []
errors = []
for region in regions:
    cmd = [
        "gcloud", "builds", "triggers", "list",
        "--project", project,
        "--format", "json",
    ]
    if region != "global":
        cmd.extend(["--region", region])
    result = run(cmd)
    if result.returncode != 0:
        errors.append(result.stderr.strip() or result.stdout.strip() or f"list failed in {region}")
        continue
    try:
        payload = json.loads(result.stdout or "[]")
    except json.JSONDecodeError:
        errors.append(f"Could not parse triggers in {region}")
        continue
    if not isinstance(payload, list):
        payload = []
    for trigger in payload:
        trigger["_region"] = region
        found.append(trigger)

if not found and errors:
    print("Could not list Cloud Build triggers.")
    print(errors[0].splitlines()[0] if errors else "")
    print("")
    print("Create the develop trigger in the same project as the main trigger:")
    print("  duplicate the main Cloud Build trigger")
    print("  set the branch filter to ^develop$")
    print("  keep build config cloudbuild.yaml")
    print("  name it deploy-sync-schedule-develop")
    sys.exit(1)

develop_triggers = []
main_triggers = []
for trigger in found:
    if not uses_cloudbuild(trigger):
        continue
    patterns = branch_patterns(trigger)
    if any(matches(pattern, "develop") for pattern in patterns):
        develop_triggers.append(trigger)
    if any(matches(pattern, "main") for pattern in patterns):
        main_triggers.append(trigger)

if develop_triggers:
    names = ", ".join(trigger.get("name", "(unnamed)") for trigger in develop_triggers)
    print(f"Develop already builds via: {names}")
    print("cloudbuild.yaml deploys that branch to sync-schedule-develop.")
    sys.exit(0)

if not main_triggers:
    print("No Cloud Build trigger for cloudbuild.yaml on main was found in this project.")
    print("Duplicate that trigger wherever it lives, with branch filter ^develop$.")
    sys.exit(1)

source = main_triggers[0]
# A trigger that already matches both branches does not need a sibling.
if any(matches(pattern, "develop") for pattern in branch_patterns(source)):
    print(f"Trigger {source.get('name')} already includes develop.")
    sys.exit(0)

region = source.pop("_region", "global")
clone = json.loads(json.dumps(source))
for key in ("id", "resourceName", "createTime", "updateTime", "_region"):
    clone.pop(key, None)
clone["name"] = "deploy-sync-schedule-develop"
clone["description"] = "Deploy the develop branch to sync-schedule-develop."
clone["disabled"] = False
set_branch(clone, "^develop$")

with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
    json.dump(clone, handle)
    path = handle.name

cmd = [
    "gcloud", "builds", "triggers", "import",
    "--source", path,
    "--project", project,
]
if region != "global":
    cmd.extend(["--region", region])
result = run(cmd)
if result.returncode != 0:
    sys.stderr.write(result.stderr or result.stdout)
    sys.exit(result.returncode)
print(result.stdout.strip())
print("Created Cloud Build trigger deploy-sync-schedule-develop for branch ^develop$.")
PY
