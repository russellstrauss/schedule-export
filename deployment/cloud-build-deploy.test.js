import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const deployScript = path.join(root, "deployment/cloud-build-deploy.sh");
const targetScript = path.join(root, "deployment/deploy-target.sh");
const configScript = path.join(root, "deployment/develop-runtime-config.py");

const prodConfig = {
  serviceConfig: {
    serviceAccountEmail: "runtime@appspot.gserviceaccount.com",
    environmentVariables: {
      SCHEDULE_SOURCES: "portal-a,portal-b",
      NOTE: 'say "hi"\nnext'
    },
    secretEnvironmentVariables: [
      { key: "RHINO_EMAIL", secret: "rhino-email", version: "latest" },
      { key: "GOOGLE_TOKEN", secret: "google-oauth-token", version: "3" },
      {
        key: "GEMINI_API_KEY",
        secret: "projects/example/secrets/gemini-api-key/versions/latest"
      }
    ]
  }
};

function writeFakeGcloud(binDir, capture) {
  const gcloud = path.join(binDir, "gcloud");
  fs.writeFileSync(
    gcloud,
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CAPTURE/invocations"
cmd="\$1"
sub="\$2"
name="\$3"
format="json"
for arg in "\$@"; do
  case "\$arg" in
    --format=*) format="\${arg#--format=}" ;;
  esac
done
if [ "\$cmd" = "functions" ] && [ "\$sub" = "describe" ]; then
  if [ "\$format" = "value(serviceConfig.uri)" ]; then
    printf '%s\\n' "https://\${name}-example-uc.a.run.app"
    exit 0
  fi
  if [ "\$name" = "sync-schedule-develop" ] && [ ! -f "$CAPTURE/develop-exists" ]; then
    echo "ERROR: (gcloud.functions.describe) ResponseError: status=[404], code=[], message=[Resource was not found]" >&2
    exit 1
  fi
  if [ "\$name" = "sync-schedule-develop" ] && [ -f "$CAPTURE/develop-denied" ]; then
    echo "ERROR: PERMISSION_DENIED" >&2
    exit 1
  fi
  if [ "\$name" = "sync-schedule-develop" ]; then
    cat "$CAPTURE/develop.json"
    exit 0
  fi
  cat "$CAPTURE/prod.json"
  exit 0
fi
if [ "\$cmd" = "functions" ] && [ "\$sub" = "deploy" ]; then
  printf '%s\\n' "\$*" >> "$CAPTURE/deploys"
  for arg in "\$@"; do
    case "\$arg" in
      --env-vars-file=*) cp "\${arg#--env-vars-file=}" "$CAPTURE/env.yaml" ;;
      --set-secrets=*) printf '%s\\n' "\${arg#--set-secrets=}" > "$CAPTURE/secrets" ;;
    esac
  done
  if [ -f "$CAPTURE/fail-seeded-deploy" ] && [[ "\$*" == *"--set-secrets="* ]]; then
    echo "seeded deploy denied" >&2
    exit 1
  fi
  touch "$CAPTURE/develop-exists"
  exit 0
fi
echo "unexpected gcloud \$*" >&2
exit 1
`
  );
  fs.chmodSync(gcloud, 0o755);
}

function runDeploy(branch, capture, extraEnv = {}) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcloud-bin-"));
  writeFakeGcloud(binDir, capture);
  const stdout = execFileSync("bash", [deployScript, "example-project", "us-central1"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      BRANCH_NAME: branch,
      CAPTURE: capture,
      ...extraEnv
    },
    encoding: "utf8"
  });
  const deploys = fs.existsSync(path.join(capture, "deploys"))
    ? fs.readFileSync(path.join(capture, "deploys"), "utf8").trim().split("\n")
    : [];
  return { stdout, deploys };
}

describe("cloudbuild config", () => {
  it("passes the function project into the deploy script", () => {
    const yaml = fs.readFileSync(path.join(root, "cloudbuild.yaml"), "utf8");
    expect(yaml).toContain("deployment/setup-develop-trigger.sh");
    const match = yaml.match(/cloud-build-deploy\.sh\s*\n\s*-\s+(\S+)[^\n]*\n\s*-\s+(\S+)/);
    expect(match).not.toBeNull();
    expect(match[1]).not.toBe("us-central1");
    expect(match[1].length).toBeGreaterThan(0);
    expect(match[2]).toBe("us-central1");
    expect(yaml.indexOf("setup-develop-trigger.sh")).toBeLessThan(yaml.indexOf("cloud-build-deploy.sh"));
    expect(yaml.match(/BRANCH_NAME=\$BRANCH_NAME/g)).toHaveLength(2);
  });
});

describe("deploy target", () => {
  it("sends develop to the testing function and every other branch to production", () => {
    const develop = execFileSync("bash", [targetScript, "develop"], { encoding: "utf8" }).trim();
    const main = execFileSync("bash", [targetScript, "main"], { encoding: "utf8" }).trim();
    const manual = execFileSync("bash", [targetScript], { encoding: "utf8" }).trim();
    const feature = execFileSync("bash", [targetScript, "cursor/something-4b4e"], {
      encoding: "utf8"
    }).trim();
    expect(develop).toBe("sync-schedule-develop");
    expect(main).toBe("sync-schedule");
    expect(manual).toBe("sync-schedule");
    expect(feature).toBe("sync-schedule");
  });
});

describe("cloud build deploy", () => {
  it("deploys main without copying environment variables", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-main-"));
    fs.writeFileSync(path.join(capture, "prod.json"), JSON.stringify(prodConfig));
    const { stdout, deploys } = runDeploy("main", capture);
    expect(deploys).toHaveLength(1);
    expect(deploys[0]).toContain("functions deploy sync-schedule ");
    expect(deploys[0]).not.toContain("sync-schedule-develop");
    expect(deploys[0]).not.toContain("--env-vars-file");
    expect(deploys[0]).not.toContain("--set-secrets");
    expect(deploys[0]).not.toContain("--service-account");
    expect(stdout).toContain("Function URL: https://sync-schedule-example-uc.a.run.app");
  });

  it("seeds a new develop function from production and prints its own URL", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-develop-"));
    fs.writeFileSync(path.join(capture, "prod.json"), JSON.stringify(prodConfig));
    const { stdout, deploys } = runDeploy("develop", capture);
    expect(deploys).toHaveLength(1);
    expect(deploys[0]).toContain("functions deploy sync-schedule-develop ");
    expect(deploys[0]).toContain("--env-vars-file=");
    expect(deploys[0]).toContain("--service-account=runtime@appspot.gserviceaccount.com");
    expect(deploys[0]).not.toContain("--project=sync-schedule ");
    const envYaml = fs.readFileSync(path.join(capture, "env.yaml"), "utf8");
    expect(envYaml).toBe(
      'SCHEDULE_SOURCES: "portal-a,portal-b"\nNOTE: "say \\"hi\\"\\nnext"\n'
    );
    expect(fs.readFileSync(path.join(capture, "secrets"), "utf8").trim()).toBe(
      "RHINO_EMAIL=rhino-email:latest,GOOGLE_TOKEN=google-oauth-token:3,GEMINI_API_KEY=projects/example/secrets/gemini-api-key/versions/latest"
    );
    expect(stdout).toContain("Function URL: https://sync-schedule-develop-example-uc.a.run.app");
    expect(stdout).toContain("?mode=health");
  });

  it("leaves an existing develop function's environment in place", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-existing-"));
    fs.writeFileSync(path.join(capture, "prod.json"), JSON.stringify(prodConfig));
    fs.writeFileSync(
      path.join(capture, "develop.json"),
      JSON.stringify({ serviceConfig: { environmentVariables: { FOO: "bar" } } })
    );
    fs.writeFileSync(path.join(capture, "develop-exists"), "");
    const { deploys } = runDeploy("develop", capture);
    expect(deploys[0]).toContain("functions deploy sync-schedule-develop ");
    expect(deploys[0]).not.toContain("--env-vars-file");
    expect(deploys[0]).not.toContain("--set-secrets");
    expect(deploys[0]).not.toContain("--service-account");
  });

  it("seeds a develop function that only has the platform log variable", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-platform-env-"));
    fs.writeFileSync(path.join(capture, "prod.json"), JSON.stringify(prodConfig));
    fs.writeFileSync(
      path.join(capture, "develop.json"),
      JSON.stringify({ serviceConfig: { environmentVariables: { LOG_EXECUTION_ID: "true" } } })
    );
    fs.writeFileSync(path.join(capture, "develop-exists"), "");
    const { deploys } = runDeploy("develop", capture);
    expect(deploys[0]).toContain("functions deploy sync-schedule-develop ");
    expect(deploys[0]).toContain("--env-vars-file=");
    expect(deploys[0]).toContain("--service-account=runtime@appspot.gserviceaccount.com");
  });

  it("retries without copied config when seeding is denied", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-retry-"));
    fs.writeFileSync(path.join(capture, "prod.json"), JSON.stringify(prodConfig));
    fs.writeFileSync(path.join(capture, "fail-seeded-deploy"), "");
    const { stdout, deploys } = runDeploy("develop", capture);
    expect(deploys).toHaveLength(2);
    expect(deploys[0]).toContain("--set-secrets=");
    expect(deploys[0]).toContain("--service-account=runtime@appspot.gserviceaccount.com");
    expect(deploys[1]).not.toContain("--set-secrets");
    expect(deploys[1]).not.toContain("--env-vars-file");
    expect(deploys[1]).not.toContain("--service-account");
    expect(deploys[1]).toContain("functions deploy sync-schedule-develop ");
    expect(stdout).toContain("Retrying without environment changes");
    expect(stdout).toContain("https://sync-schedule-develop-example-uc.a.run.app");
  });

  it("still deploys develop when the existing function cannot be read", () => {
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-denied-"));
    fs.writeFileSync(path.join(capture, "prod.json"), JSON.stringify(prodConfig));
    fs.writeFileSync(path.join(capture, "develop-exists"), "");
    fs.writeFileSync(path.join(capture, "develop-denied"), "");
    const { stdout, deploys } = runDeploy("develop", capture);
    expect(deploys[0]).toContain("functions deploy sync-schedule-develop ");
    expect(deploys[0]).not.toContain("--set-secrets");
    expect(stdout).toContain("without changing its environment variables");
  });
});

describe("develop runtime config", () => {
  it("skips seeding when the target already has secrets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-config-"));
    const prod = path.join(dir, "prod.json");
    const target = path.join(dir, "target.json");
    const envFile = path.join(dir, "env.yaml");
    fs.writeFileSync(prod, JSON.stringify(prodConfig));
    fs.writeFileSync(
      target,
      JSON.stringify({
        serviceConfig: { secretEnvironmentVariables: [{ key: "RHINO_EMAIL", secret: "rhino-email" }] }
      })
    );
    const stdout = execFileSync(
      "python3",
      [configScript, "--prod-json", prod, "--target-json", target, "--env-file", envFile],
      { encoding: "utf8" }
    ).trim();
    expect(stdout).toBe("skip");
  });

  it("seeds when the target only has the platform log variable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-config-platform-"));
    const prod = path.join(dir, "prod.json");
    const target = path.join(dir, "target.json");
    const envFile = path.join(dir, "env.yaml");
    fs.writeFileSync(prod, JSON.stringify(prodConfig));
    fs.writeFileSync(
      target,
      JSON.stringify({ serviceConfig: { environmentVariables: { LOG_EXECUTION_ID: "true" } } })
    );
    const stdout = execFileSync(
      "python3",
      [configScript, "--prod-json", prod, "--target-json", target, "--env-file", envFile],
      { encoding: "utf8" }
    ).trim();
    expect(stdout.startsWith("seed ")).toBe(true);
  });
});
