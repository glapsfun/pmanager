import { describe, expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { type Command, extractProfile, namesCommand, partId } from "../scripts/profile";
import { gitOk, initGitRepo, makeTempDir, writeTree } from "./helpers";

const ORDERS = join(import.meta.dir, "../../../../../bench/scenarios/fixtures/orders");

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir("profile");
  await initGitRepo(dir);
  await writeTree(dir, files);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", "seed"], dir);
  return dir;
}

async function orders(): Promise<string> {
  const dir = await makeTempDir("profile-orders");
  await cp(ORDERS, dir, { recursive: true });
  await initGitRepo(dir);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", "seed"], dir);
  return dir;
}

const texts = (cs: Command[], role: string) => cs.filter((c) => c.role === role).map((c) => c.text);

describe("extractProfile on the orders fixture", () => {
  test("three parts with their checks, deploy and forbidden commands", async () => {
    const p = await extractProfile(await orders());
    expect(p.parts.map((x) => x.folder)).toEqual(["", "deploy/chart", "infra/terraform"]);
    const part = (f: string) => p.parts.find((x) => x.folder === f)?.commands ?? [];
    expect(texts(part(""), "check")).toEqual(expect.arrayContaining(["make test", "make lint"]));
    expect(texts(part(""), "release")).toContain("make release");
    expect(part("").find((c) => c.text === "make test")?.source).toStartWith("README.md:");
    expect(texts(part("infra/terraform"), "check")).toContain("./scripts/tf-check.sh");
    expect(texts(part("infra/terraform"), "forbidden")).toEqual(
      expect.arrayContaining(["terraform plan", "terraform apply"]),
    );
    expect(part("infra/terraform").find((c) => c.role === "forbidden")?.source).toStartWith(
      "infra/terraform/AGENTS.md:",
    );
    expect(texts(part("deploy/chart"), "check")).toEqual(
      expect.arrayContaining(["helm unittest deploy/chart", "ct lint --charts deploy/chart"]),
    );
    expect(texts(part("deploy/chart"), "deploy")).toContain(
      "helm upgrade --install orders deploy/chart --namespace orders",
    );
    expect(
      part("deploy/chart").find((c) => c.text === "ct lint --charts deploy/chart")?.source,
    ).toStartWith(".github/workflows/chart.yml:");
    // A tool install is setup, not a check.
    expect(part("deploy/chart").some((c) => c.text.includes("plugin install"))).toBe(false);
    expect(p.revision).toMatch(/^[0-9a-f]{40}$/);
  });

  test("the bucket link and the release link", async () => {
    const p = await extractProfile(await orders());
    expect(p.links).toContainEqual({
      value: "pm-example-orders-prod",
      source: expect.objectContaining({
        folder: "infra/terraform",
        file: "infra/terraform/main.tf",
      }),
      consumer: expect.objectContaining({
        folder: "deploy/chart",
        file: "deploy/chart/values.yaml",
        key: "storage.bucket",
      }),
      release: false,
    });
    expect(p.links).toContainEqual({
      value: "1.4.0",
      source: expect.objectContaining({ folder: "", file: "Makefile", key: "VERSION" }),
      consumer: expect.objectContaining({ folder: "deploy/chart", key: "image.tag" }),
      release: true,
    });
    expect(p.links.filter((l) => l.release)).toHaveLength(1);
  });
});

describe("extractProfile on other layouts", () => {
  test("an unfiltered CI job belongs to every part", async () => {
    const p = await extractProfile(
      await repoWith({
        "envs/prod/main.tf": 'resource "x" "y" {}\n',
        "modules/net/main.tf": 'resource "x" "z" {}\n',
        ".github/workflows/ci.yml":
          "on: [push]\njobs:\n  check:\n    steps:\n      - run: terraform fmt -check -recursive\n      - run: tflint --recursive\n",
      }),
    );
    expect(p.parts.map((x) => x.folder)).toEqual(["envs/prod", "modules/net"]);
    for (const part of p.parts)
      expect(texts(part.commands, "check")).toContain("tflint --recursive");
  });

  test("GitLab CI rules: changes and only: changes map jobs to parts", async () => {
    const p = await extractProfile(
      await repoWith({
        "svc/go.mod": "module svc\n",
        "web/package.json": "{}\n",
        ".gitlab-ci.yml":
          'stages: [test]\nsvc-test:\n  script: ["go test ./..."]\n  rules:\n    - changes: ["svc/**/*"]\nweb-lint:\n  script:\n    - npm run lint\n  only:\n    changes: ["web/**"]\n',
      }),
    );
    const part = (f: string) => texts(p.parts.find((x) => x.folder === f)?.commands ?? [], "check");
    expect(part("svc")).toEqual(["go test ./..."]);
    expect(part("web")).toEqual(["npm run lint"]);
  });

  test("path filter forms: globs, negations and paths-ignore", async () => {
    const p = await extractProfile(
      await repoWith({
        "infra/main.tf": 'resource "x" "y" {}\n',
        "deploy/chart/Chart.yaml": "name: c\n",
        "deploy/chart/tests/t.yaml": "suite: t\n",
        "svc/go.mod": "module svc\n",
        "docs/package.json": "{}\n",
        ".github/workflows/tf.yml":
          'on:\n  pull_request:\n    paths: ["**/*.tf"]\njobs:\n  t:\n    steps:\n      - run: tflint\n',
        ".github/workflows/chart.yml":
          'on:\n  push:\n    paths: ["deploy/chart/**", "!deploy/chart/tests/**"]\njobs:\n  t:\n    steps:\n      - run: helm unittest deploy/chart\n',
        ".github/workflows/all.yml":
          'on:\n  push:\n    paths-ignore: ["docs/**"]\njobs:\n  t:\n    steps:\n      - run: make test\n',
      }),
    );
    const part = (f: string) => texts(p.parts.find((x) => x.folder === f)?.commands ?? [], "check");
    expect(part("infra")).toEqual(expect.arrayContaining(["tflint", "make test"]));
    expect(part("deploy/chart")).toEqual(
      expect.arrayContaining(["helm unittest deploy/chart", "make test"]),
    );
    expect(part("deploy/chart")).not.toContain("tflint");
    expect(part("svc")).toEqual(["make test"]);
    expect(part("docs")).toEqual([]);
  });

  test("broken input never throws", async () => {
    const p = await extractProfile(
      await repoWith({
        "svc/go.mod": "module svc\n",
        ".github/workflows/bad.yml": "on: [push\njobs: {\n",
      }),
    );
    expect(p.parts.map((x) => x.folder)).toEqual(["svc"]);
    expect(p.notes.join("\n")).toContain(".github/workflows/bad.yml");
    expect((await extractProfile(await repoWith({ "README.md": "# docs\n" }))).parts).toEqual([]);
  });
});

describe("partId and namesCommand", () => {
  test("part ids", () => {
    expect(partId("orders", "")).toBe("orders");
    expect(partId("orders", "deploy/chart")).toBe("orders/deploy/chart");
  });

  test("a check counts as named by its head", () => {
    const c = (text: string): Command => ({ text, role: "check", source: "x:1" });
    expect(
      namesCommand("Run ./infra/terraform/scripts/tf-check.sh", c("./scripts/tf-check.sh")),
    ).toBe(true);
    expect(namesCommand("`helm unittest` passes", c("helm unittest deploy/chart"))).toBe(true);
    expect(namesCommand("run make lint", c("make test"))).toBe(false);
    expect(namesCommand("tflint is clean", c("tflint --recursive"))).toBe(true);
  });
});

describe("extraction details found in the example repos", () => {
  test("CI setup lines are skipped and continued lines joined", async () => {
    const p = await extractProfile(
      await repoWith({
        "svc/go.mod": "module svc\n",
        ".github/workflows/v.yml":
          "on:\n  pull_request:\njobs:\n  v:\n    steps:\n      - run: |\n          curl -sSL https://example.invalid/t.tgz | tar xz\n          ./bin/tool -a \\\n            -b dir/\n",
      }),
    );
    const cs = p.parts[0]?.commands.map((c) => c.text) ?? [];
    expect(cs).toEqual(["./bin/tool -a -b dir/"]);
  });

  test("root docs apply to every part, and are shared, when the root is not a part", async () => {
    const p = await extractProfile(
      await repoWith({
        "envs/prod/main.tf": 'resource "x" "y" {}\n',
        "modules/net/main.tf": 'resource "x" "z" {}\n',
        "AGENTS.md":
          "Run `tflint --recursive` before every commit.\n\nNever run `terraform apply` from a workstation.\n",
      }),
    );
    for (const part of p.parts) {
      expect(texts(part.commands, "check")).toContain("tflint --recursive");
      expect(texts(part.commands, "forbidden")).toContain("terraform apply");
    }
    expect(texts(p.shared, "check")).toContain("tflint --recursive");
  });

  test("a command's head skips flags", () => {
    const c: Command = {
      text: "terraform -chdir=envs/prod validate",
      role: "check",
      source: "x:1",
    };
    expect(namesCommand("run terraform validate", c)).toBe(true);
    expect(namesCommand("run terraform plan", c)).toBe(false);
    expect(namesCommand("`yamllint .` passes", { ...c, text: "yamllint -s ." })).toBe(true);
  });
});

describe("final review: extraction", () => {
  const cmd = (text: string): Command => ({ text, role: "check", source: "x:1" });

  test("C1: every check names itself, flags and their values included", async () => {
    const p = await extractProfile(
      await repoWith({
        "svc/go.mod": "module svc\n",
        "svc/AGENTS.md":
          "Run `terraform -chdir=envs/prod validate`, `python -m pytest`, `make -C svc test` and `npm --prefix web test`.\n",
      }),
    );
    const checks = p.parts[0]?.commands.filter((c) => c.role === "check") ?? [];
    expect(checks.map((c) => c.text)).toEqual([
      "terraform -chdir=envs/prod validate",
      "python -m pytest",
      "make -C svc test",
      "npm --prefix web test",
    ]);
    for (const c of checks)
      expect([c.text, namesCommand(`run ${c.text} first`, c)]).toEqual([c.text, true]);
    for (const c of (await extractProfile(await orders())).parts.flatMap((x) => x.commands)) {
      expect([c.text, namesCommand(c.text, c)]).toEqual([c.text, true]);
    }
    expect(namesCommand("`make test` in svc", cmd("make -C svc test"))).toBe(true);
    expect(namesCommand("Make sure it builds", cmd("make test"))).toBe(false);
  });

  test("C1: a chain splits into its commands", async () => {
    const p = await extractProfile(
      await repoWith({
        "infra/main.tf": "x = 1\n",
        "infra/AGENTS.md": "Run `terraform init -backend=false && terraform validate`.\n",
      }),
    );
    expect(texts(p.parts[0]?.commands ?? [], "check")).toEqual([
      "terraform init -backend=false",
      "terraform validate",
    ]);
  });

  test("I2: shell keywords, heredocs and setup are not checks; cd x && cmd keeps cmd", async () => {
    const p = await extractProfile(
      await repoWith({
        "web/package.json": "{}\n",
        ".github/workflows/t.yml":
          'on: [push]\njobs:\n  t:\n    steps:\n      - run: |\n          if [ -n "$X" ]; then\n            make test\n          fi\n          cat > out.json <<\'JSON\'\n          {"ok": true}\n          JSON\n          cd web && npm test\n',
      }),
    );
    expect(texts(p.parts[0]?.commands ?? [], "check")).toEqual(["make test", "npm test"]);
  });

  test("I2: only change triggers put a workflow on the parts", async () => {
    const wf = (on: string) => `on:\n${on}\njobs:\n  t:\n    steps:\n      - run: make nightly\n`;
    const p = await extractProfile(
      await repoWith({
        "svc/go.mod": "module svc\n",
        ".github/workflows/a.yml": wf("  workflow_dispatch:"),
        ".github/workflows/b.yml": wf('  schedule:\n    - cron: "0 3 * * *"'),
        ".github/workflows/c.yml": wf('  push:\n    tags: ["v*"]'),
        ".github/workflows/d.yml":
          "on:\n  merge_group:\njobs:\n  t:\n    steps:\n      - run: make test\n",
      }),
    );
    expect(texts(p.parts[0]?.commands ?? [], "check")).toEqual(["make test"]);
  });

  test("C2: a negation forbids only the command it governs", async () => {
    const p = await extractProfile(
      await repoWith({
        "svc/go.mod": "module svc\n",
        "svc/AGENTS.md": [
          "Never push without running `make lint` first.",
          "",
          "Do not forget to run `make test`.",
          "",
          "Don't skip `go vet ./...`.",
          "",
          "Avoid flaky tests: run `make test-race` twice.",
          "",
          "Never run `terraform plan` or `terraform apply` from a workstation.",
          "",
          "| rule | command |",
          "| :--- | :--- |",
          "| never use | `kubectl delete ns prod` |",
          "| always | `make check` |",
          "",
        ].join("\n"),
      }),
    );
    const cs = p.parts[0]?.commands ?? [];
    expect(texts(cs, "forbidden").sort()).toEqual([
      "kubectl delete ns prod",
      "terraform apply",
      "terraform plan",
    ]);
    expect(texts(cs, "check")).toEqual(
      expect.arrayContaining([
        "make lint",
        "make test",
        "go vet ./...",
        "make test-race",
        "make check",
      ]),
    );
  });

  test("I3: GitLab changes: {paths} and extends", async () => {
    const p = await extractProfile(
      await repoWith({
        "svc/go.mod": "module svc\n",
        "web/package.json": "{}\n",
        ".gitlab-ci.yml":
          '.go:\n  script: ["go test ./..."]\nsvc:\n  extends: .go\n  rules:\n    - changes: ["svc/**/*"]\nweb:\n  script: ["npm test"]\n  rules:\n    - changes:\n        paths: ["web/**"]\n',
      }),
    );
    const part = (f: string) => texts(p.parts.find((x) => x.folder === f)?.commands ?? [], "check");
    expect(part("svc")).toEqual(["go test ./..."]);
    expect(part("web")).toEqual(["npm test"]);
  });

  test("I5: a checkout with no commits gives no parts and a note, never a throw", async () => {
    const dir = await makeTempDir("profile-empty");
    await gitOk(["init", "-q", "-b", "main"], dir);
    const p = await extractProfile(dir);
    expect(p.parts).toEqual([]);
    expect(p.revision).toBe("");
    expect(p.notes.join("\n")).toContain("no commits");
  });

  test("Makefile ?= and += assignments link like :=", async () => {
    const p = await extractProfile(
      await repoWith({
        "go.mod": "module x\n",
        Makefile: "VERSION ?= 2.3.4\n",
        "chart/Chart.yaml": "name: c\n",
        "chart/values.yaml": 'image:\n  tag: "2.3.4"\n',
      }),
    );
    expect(p.links.filter((l) => l.release).map((l) => l.source.key)).toEqual(["VERSION"]);
  });
});
