#!/usr/bin/env python3
"""Ensure a Cloud Build trigger deploys every push to the develop branch.

The production trigger lives in gen-lang-client-0523900922, region
northamerica-northeast2, and is named push-production-schedule-sync.
This copies it to push-develop-schedule-sync with branch filter ^develop$.
The production trigger is not modified.

Set ENSURE_TRIGGER_OPTIONAL=1 to keep going when this account cannot manage
triggers. A manual run fails instead, so a permissions problem is visible.
"""

import json
import os
import re
import subprocess
import sys
import tempfile

PROJECT = os.environ.get("DEVELOP_TRIGGER_PROJECT", "gen-lang-client-0523900922")
REGION = os.environ.get("DEVELOP_TRIGGER_REGION", "northamerica-northeast2")
SOURCE_TRIGGER_ID = "92538bbd-76fe-4dcc-a8de-23e3616eefe7"
SOURCE_TRIGGER_NAME = "push-production-schedule-sync"
DEVELOP_TRIGGER_NAME = "push-develop-schedule-sync"
OPTIONAL = os.environ.get("ENSURE_TRIGGER_OPTIONAL", "") == "1"
OUTPUT_ONLY = {
    "id",
    "resourceName",
    "createTime",
    "updateTime",
    "_region",
}


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
    github_push = (trigger.get("github") or {}).get("push") or {}
    if github_push.get("branch"):
        patterns.append(github_push["branch"])
    event_push = (trigger.get("repositoryEventConfig") or {}).get("push") or {}
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
    if trigger.get("github"):
        trigger.setdefault("github", {}).setdefault("push", {})["branch"] = pattern
    if trigger.get("repositoryEventConfig"):
        trigger.setdefault("repositoryEventConfig", {}).setdefault("push", {})["branch"] = pattern
    if trigger.get("triggerTemplate"):
        trigger["triggerTemplate"]["branchName"] = pattern


def fail(message, detail=""):
    print(message)
    if detail:
        first = detail.strip().splitlines()
        if first:
            print(first[0])
    print("")
    print(f"In Cloud Build, project {PROJECT}, region {REGION}:")
    print(f"  duplicate {SOURCE_TRIGGER_NAME}")
    print(f"  name it {DEVELOP_TRIGGER_NAME}")
    print("  set the push branch filter to ^develop$")
    print("  keep build config cloudbuild.yaml")
    if OPTIONAL:
        print("Continuing the build without creating the trigger.")
        sys.exit(0)
    sys.exit(1)


def gcloud_json(args):
    result = run(args)
    if result.returncode != 0:
        return None, (result.stderr or result.stdout or "gcloud failed")
    try:
        return json.loads(result.stdout or "null"), ""
    except json.JSONDecodeError:
        return None, "Could not parse gcloud JSON"


def load_triggers():
    payload, error = gcloud_json(
        [
            "gcloud",
            "builds",
            "triggers",
            "list",
            "--project",
            PROJECT,
            "--region",
            REGION,
            "--format",
            "json",
        ]
    )
    if error:
        return None, error
    if not isinstance(payload, list):
        return [], ""
    return payload, ""


def load_source(triggers):
    for trigger in triggers:
        if trigger.get("id") == SOURCE_TRIGGER_ID or trigger.get("name") == SOURCE_TRIGGER_NAME:
            return trigger, ""
    payload, error = gcloud_json(
        [
            "gcloud",
            "builds",
            "triggers",
            "describe",
            SOURCE_TRIGGER_ID,
            "--project",
            PROJECT,
            "--region",
            REGION,
            "--format",
            "json",
        ]
    )
    if error or not isinstance(payload, dict):
        return None, error or "Production trigger was not found"
    return payload, ""


def import_trigger(trigger):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(trigger, handle)
        path = handle.name
    result = run(
        [
            "gcloud",
            "builds",
            "triggers",
            "import",
            "--source",
            path,
            "--project",
            PROJECT,
            "--region",
            REGION,
        ]
    )
    detail = result.stderr or result.stdout or ""
    if result.returncode == 0:
        return "created", detail
    if "ALREADY_EXISTS" in detail or "already exists" in detail.lower():
        return "exists", detail
    return "error", detail


def run_develop_build():
    if os.environ.get("BRANCH_NAME") == "develop":
        print("Already building develop, so not starting another build.")
        return
    result = run(
        [
            "gcloud",
            "builds",
            "triggers",
            "run",
            DEVELOP_TRIGGER_NAME,
            "--project",
            PROJECT,
            "--region",
            REGION,
            "--branch",
            "develop",
        ]
    )
    if result.returncode != 0:
        print("Created the trigger, but could not start a build of the current develop commit.")
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        if detail:
            print(detail[0])
        return
    print(result.stdout.strip())
    print("Started a build of the current develop commit.")


def main():
    print(f"Cloud Build project: {PROJECT}")
    print(f"Cloud Build region: {REGION}")
    triggers, error = load_triggers()
    if triggers is None:
        fail("Could not list Cloud Build triggers.", error)

    develop = [
        trigger
        for trigger in triggers
        if any(matches(pattern, "develop") for pattern in branch_patterns(trigger))
        and (uses_cloudbuild(trigger) or trigger.get("name") == DEVELOP_TRIGGER_NAME)
    ]
    if develop:
        names = ", ".join(trigger.get("name", "(unnamed)") for trigger in develop)
        print(f"Develop pushes already build via: {names}")
        return

    source, error = load_source(triggers)
    if source is None:
        fail("Could not read the production Cloud Build trigger.", error)
    if any(matches(pattern, "develop") for pattern in branch_patterns(source)):
        print(f"{source.get('name')} already includes develop.")
        return

    clone = json.loads(json.dumps(source))
    for key in OUTPUT_ONLY:
        clone.pop(key, None)
    clone.pop("includedFiles", None)
    clone.pop("ignoredFiles", None)
    clone["name"] = DEVELOP_TRIGGER_NAME
    clone["filename"] = "cloudbuild.yaml"
    clone["description"] = "Deploy every push to develop to sync-schedule-develop."
    clone["disabled"] = False
    set_branch(clone, "^develop$")

    status, detail = import_trigger(clone)
    if status == "error":
        fail(f"Could not create {DEVELOP_TRIGGER_NAME}.", detail)
    if status == "exists":
        print(f"{DEVELOP_TRIGGER_NAME} already exists.")
        return
    print(f"Created Cloud Build trigger {DEVELOP_TRIGGER_NAME} for branch ^develop$.")
    print("Every push to develop deploys sync-schedule-develop.")
    run_develop_build()


if __name__ == "__main__":
    main()
