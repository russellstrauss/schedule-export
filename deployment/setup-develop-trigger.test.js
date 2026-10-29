import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "deployment/setup-develop-trigger.sh");

const productionTrigger = {
  id: "92538bbd-76fe-4dcc-a8de-23e3616eefe7",
  name: "push-production-schedule-sync",
  filename: "cloudbuild.yaml",
  createTime: "2026-01-01T00:00:00Z",
  resourceName:
    "projects/gen-lang-client-0523900922/locations/northamerica-northeast2/triggers/92538bbd-76fe-4dcc-a8de-23e3616eefe7",
  serviceAccount:
    "projects/gen-lang-client-0523900922/serviceAccounts/builder@gen-lang-client-0523900922.iam.gserviceaccount.com",
  includedFiles: ["main.js"],
  developerConnectEventConfig: {
    gitRepositoryLink:
      "projects/gen-lang-client-0523900922/locations/northamerica-northeast2/connections/GitHub/gitRepositoryLinks/russellstrauss-schedule-export",
    gitRepositoryLinkType: "GITHUB",
    push: { branch: "^main$" }
  }
};

function writeFakeGcloud(binDir) {
  const gcloud = path.join(binDir, "gcloud");
  fs.writeFileSync(
    gcloud,
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CAPTURE/invocations"
region=""
source_file=""
prev=""
for arg in "$@"; do
  case "$arg" in
    --region=*) region="\${arg#--region=}" ;;
    --source=*) source_file="\${arg#--source=}" ;;
    --region) ;;
  esac
  if [ "$prev" = "--region" ]; then region="$arg"; fi
  if [ "$prev" = "--source" ]; then source_file="$arg"; fi
  prev="$arg"
done
if [ "$1 $2 $3" = "builds triggers list" ]; then
  if [ "$region" != "northamerica-northeast2" ]; then
    echo "ERROR: PERMISSION_DENIED wrong region" >&2
    exit 1
  fi
  if [ -f "$CAPTURE/deny-list" ]; then
    echo "ERROR: PERMISSION_DENIED" >&2
    exit 1
  fi
  if [ -f "$CAPTURE/triggers.json" ]; then
    cat "$CAPTURE/triggers.json"
  else
    echo "[]"
  fi
  exit 0
fi
if [ "$1 $2 $3" = "builds triggers import" ]; then
  cp "$source_file" "$CAPTURE/imported.json"
  if [ -f "$CAPTURE/fail-import" ]; then
    echo "ERROR: import failed" >&2
    exit 1
  fi
  exit 0
fi
if [ "$1 $2 $3" = "builds triggers run" ]; then
  printf '%s\\n' "$*" >> "$CAPTURE/runs"
  exit 0
fi
if [ "$1 $2 $3" = "builds triggers describe" ]; then
  echo "ERROR: PERMISSION_DENIED" >&2
  exit 1
fi
echo "unexpected gcloud $*" >&2
exit 1
`
  );
  fs.chmodSync(gcloud, 0o755);
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(binDir, "gcloud.cmd"),
      `@echo off\r\nbash "%~dp0gcloud" %*\r\n`
    );
  }
}

function runSetup(capture, env = {}) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-gcloud-"));
  writeFakeGcloud(binDir);
  let stdout = "";
  let status = 0;
  try {
    stdout = execFileSync("bash", [script], {
      cwd: root,
      env: {
        ...process.env,
        PATH: [binDir, process.env.PATH].filter(Boolean).join(path.delimiter),
        CAPTURE: capture,
        ...env
      },
      encoding: "utf8"
    });
  } catch (error) {
    status = error.status ?? 1;
    stdout = `${error.stdout || ""}${error.stderr || ""}`;
  }
  return { stdout, status };
}

describe("develop Cloud Build trigger", () => {
  it("copies the production trigger onto ^develop$ and builds the current commit", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-create-"));
    fs.writeFileSync(path.join(capture, "triggers.json"), JSON.stringify([productionTrigger]));
    const { stdout, status } = runSetup(capture, { BRANCH_NAME: "main" });
    expect(status).toBe(0);
    expect(stdout).toContain("Created Cloud Build trigger push-develop-schedule-sync");
    const imported = JSON.parse(fs.readFileSync(path.join(capture, "imported.json"), "utf8"));
    expect(imported.name).toBe("push-develop-schedule-sync");
    expect(imported.filename).toBe("cloudbuild.yaml");
    expect(imported.developerConnectEventConfig.push.branch).toBe("^develop$");
    expect(imported.developerConnectEventConfig.gitRepositoryLink).toBe(
      productionTrigger.developerConnectEventConfig.gitRepositoryLink
    );
    expect(imported.serviceAccount).toBe(productionTrigger.serviceAccount);
    expect(imported.createTime).toBeUndefined();
    expect(imported.resourceName).toBeUndefined();
    expect(imported.includedFiles).toBeUndefined();
    const runs = fs.readFileSync(path.join(capture, "runs"), "utf8");
    expect(runs).toContain("triggers run push-develop-schedule-sync");
    expect(runs).toContain("--branch develop");
    expect(runs).toContain("--region northamerica-northeast2");
  });

  it("leaves an existing develop trigger alone", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-exists-"));
    fs.writeFileSync(
      path.join(capture, "triggers.json"),
      JSON.stringify([
        productionTrigger,
        {
          name: "push-develop-schedule-sync",
          filename: "cloudbuild.yaml",
          developerConnectEventConfig: {
            push: { branch: "^develop$" }
          }
        }
      ])
    );
    const { stdout, status } = runSetup(capture);
    expect(status).toBe(0);
    expect(stdout).toContain("already build via: push-develop-schedule-sync");
    expect(fs.existsSync(path.join(capture, "imported.json"))).toBe(false);
    expect(fs.existsSync(path.join(capture, "runs"))).toBe(false);
  });

  it("stops a manual run when triggers cannot be listed", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-denied-"));
    fs.writeFileSync(path.join(capture, "deny-list"), "");
    const { stdout, status } = runSetup(capture);
    expect(status).toBe(1);
    expect(stdout).toContain("northamerica-northeast2");
    expect(stdout).toContain("push-production-schedule-sync");
  });

  it("continues a Cloud Build when trigger setup is optional and denied", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-optional-"));
    fs.writeFileSync(path.join(capture, "deny-list"), "");
    const { stdout, status } = runSetup(capture, { ENSURE_TRIGGER_OPTIONAL: "1" });
    expect(status).toBe(0);
    expect(stdout).toContain("Continuing the build");
  });
});
