#!/usr/bin/env python3
"""Plan runtime-config seeding for the develop Cloud Function.

Stdout is one line:
  skip
  seed <env-count> <secrets-flag-or-dash>

The secrets flag is comma-separated NAME=secret:version bindings.
It contains Secret Manager names, never secret payloads.
"""

import argparse
import json
import re
import sys


def load(path):
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"{path} is not a JSON object")
    return data


def service_config(doc):
    config = doc.get("serviceConfig")
    return config if isinstance(config, dict) else {}


def configured(doc):
    config = service_config(doc)
    env = config.get("environmentVariables") or {}
    secrets = config.get("secretEnvironmentVariables") or []
    return bool(env) or bool(secrets)


def yaml_key(key):
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        return key
    return json.dumps(key)


def secret_binding(item):
    key = item.get("key")
    secret = item.get("secret")
    if not key or not secret:
        return None
    if str(secret).startswith("projects/"):
        return f"{key}={secret}"
    version = item.get("version") or "latest"
    return f"{key}={secret}:{version}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prod-json", required=True)
    parser.add_argument("--target-json", required=True)
    parser.add_argument("--env-file", required=True)
    args = parser.parse_args()

    target = load(args.target_json)
    if configured(target):
        print("skip")
        return

    prod = load(args.prod_json)
    config = service_config(prod)
    env = config.get("environmentVariables") or {}
    secrets = config.get("secretEnvironmentVariables") or []
    if not isinstance(env, dict):
        env = {}
    if not isinstance(secrets, list):
        secrets = []

    secret_keys = {
        item.get("key") for item in secrets if isinstance(item, dict) and item.get("key")
    }
    lines = []
    for key, value in env.items():
        if key in secret_keys:
            continue
        if not isinstance(value, str):
            value = "" if value is None else str(value)
        lines.append(f"{yaml_key(key)}: {json.dumps(value)}")

    with open(args.env_file, "w", encoding="utf-8", newline="\n") as handle:
        if lines:
            handle.write("\n".join(lines))
            handle.write("\n")

    bindings = []
    for item in secrets:
        if not isinstance(item, dict):
            continue
        binding = secret_binding(item)
        if binding:
            bindings.append(binding)

    secret_arg = ",".join(bindings) if bindings else "-"
    print(f"seed {len(lines)} {secret_arg}")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
