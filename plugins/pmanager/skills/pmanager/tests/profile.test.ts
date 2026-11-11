import { describe, expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import {
  type Command,
  extractProfile,
  formatPartsBlock,
  namesCommand,
  type Profile,
  partId,
  readProfile,
  renderProfileSection,
} from "../scripts/profile";
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

describe("what a make target runs", () => {
  test("a make target carries the commands its recipe runs", async () => {
    const p = await extractProfile(await orders());
    const root = p.parts.find((x) => x.folder === "")?.commands ?? [];
    expect(root.find((c) => c.text === "make test")?.runs).toEqual(["go test ./..."]);
    expect(root.find((c) => c.text === "make lint")?.runs).toEqual(["go vet ./..."]);
    expect(root.find((c) => c.text === "make release")?.runs).toEqual([
      "docker build -t $(IMAGE):$(VERSION) .",
      "docker push $(IMAGE):$(VERSION)",
    ]);
  });

  test("recipe prefixes drop, non-commands are skipped, and make -C or a missing target runs nothing", async () => {
    const p = await extractProfile(
      await repoWith({
        "go.mod": "module x\n",
        "README.md": "Run `make check`, `make -C sub test` and `make nothing`.\n",
        Makefile:
          ".PHONY: check\ncheck: deps\n\t@go vet ./...\n\t-golangci-lint run\n\techo done\n\nother:\n\tgo build\n",
      }),
    );
    const cs = p.parts.find((x) => x.folder === "")?.commands ?? [];
    expect(cs.find((c) => c.text === "make check")?.runs).toEqual([
      "go vet ./...",
      "golangci-lint run",
    ]);
    expect(cs.find((c) => c.text === "make -C sub test")).toBeDefined();
    expect(cs.find((c) => c.text === "make -C sub test")?.runs).toBeUndefined();
    expect(cs.find((c) => c.text === "make nothing")?.runs).toBeUndefined();
  });

  test("a task names a target by what it runs", () => {
    const c: Command = {
      text: "make test",
      role: "check",
      source: "README.md:7",
      runs: ["go test ./..."],
    };
    expect(namesCommand("`go test ./...` passes", c)).toBe(true);
    expect(namesCommand("`go build` passes", c)).toBe(false);
    // Verbatim only: a release recipe's docker build must not make any docker mention a release.
    const release: Command = {
      text: "make release",
      role: "release",
      source: "README.md:7",
      runs: ["docker build -t $(IMAGE):$(VERSION) ."],
    };
    expect(namesCommand("the docker build still works", release)).toBe(false);
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

describe("review of the cuts", () => {
  const runsOf = (p: Profile, folder: string, text: string) =>
    p.parts.find((x) => x.folder === folder)?.commands.find((c) => c.text === text)?.runs;

  test("1: an unfiltered CI job's make target runs the root Makefile, and each part keeps its own copy", async () => {
    const p = await extractProfile(
      await repoWith({
        "go.mod": "module x\n",
        Makefile: "test:\n\tgo test ./...\n",
        "deploy/chart/Chart.yaml": "name: c\n",
        "deploy/chart/Makefile": "test:\n\thelm unittest .\nlint:\n\tct lint --charts .\n",
        "deploy/chart/README.md": "Run `make lint`.\n",
        ".github/workflows/ci.yml":
          "on: [push]\njobs:\n  ci:\n    steps:\n      - run: make test\n",
      }),
    );
    expect(runsOf(p, "", "make test")).toEqual(["go test ./..."]);
    expect(runsOf(p, "deploy/chart", "make test")).toEqual(["go test ./..."]);
    expect(runsOf(p, "deploy/chart", "make lint")).toEqual(["ct lint --charts ."]);
    expect(p.shared.find((c) => c.text === "make test")?.runs).toEqual(["go test ./..."]);
  });

  test("1: a repo whose root is no part reads the root Makefile for its CI jobs", async () => {
    const p = await extractProfile(
      await repoWith({
        "envs/prod/main.tf": 'resource "x" "y" {}\n',
        Makefile: "check:\n\ttflint --recursive\n",
        ".github/workflows/ci.yml":
          "on: [push]\njobs:\n  ci:\n    steps:\n      - run: make check\n",
      }),
    );
    expect(p.shared.find((c) => c.text === "make check")?.runs).toEqual(["tflint --recursive"]);
    expect(runsOf(p, "envs/prod", "make check")).toEqual(["tflint --recursive"]);
  });

  test("2: continuations join; setup steps and single words are not what a target runs", async () => {
    const p = await extractProfile(
      await repoWith({
        "go.mod": "module x\n",
        "README.md": "Run `make test`.\n",
        Makefile:
          "test:\n\tgo mod download\n\tnpm install\n\tcd sub && make\n\ttrue\n\tgo test -race \\\n\t\t./...\n",
      }),
    );
    expect(runsOf(p, "", "make test")).toEqual(["go test -race ./..."]);
  });

  test("2: what a target runs counts as a whole word, not inside another command", () => {
    const c: Command = {
      text: "make test",
      role: "check",
      source: "README.md:1",
      runs: ["npm test"],
    };
    expect(namesCommand("`npm test` passes", c)).toBe(true);
    expect(namesCommand("`pnpm test` passes", c)).toBe(false);
    const go: Command = {
      text: "make test",
      role: "check",
      source: "README.md:1",
      runs: ["go test -race ./..."],
    };
    expect(namesCommand("`go build ./...` succeeds", go)).toBe(false);
  });

  test("4: later rules, :: rules, inline recipes and conditionals keep a target's recipe", async () => {
    const p = await extractProfile(
      await repoWith({
        "go.mod": "module x\n",
        "README.md": "Run `make test`, `make vet`, `make both`, `make inline` and `make X`.\n",
        Makefile: [
          "test:",
          "\tgo test ./...",
          "test: GOFLAGS = -race",
          "test: generate",
          "vet:",
          "\tgo vet ./...",
          "ifeq ($(CI),1)",
          "\tgolangci-lint run",
          "endif",
          "both::",
          "\tgo test ./a/...",
          "both::",
          "\tgo test ./b/...",
          "inline: ; go build ./...",
          "X ::= 1",
          "\tgo build",
          "",
        ].join("\n"),
      }),
    );
    expect(runsOf(p, "", "make test")).toEqual(["go test ./..."]);
    expect(runsOf(p, "", "make vet")).toEqual(["go vet ./...", "golangci-lint run"]);
    expect(runsOf(p, "", "make both")).toEqual(["go test ./a/...", "go test ./b/..."]);
    expect(runsOf(p, "", "make inline")).toEqual(["go build ./..."]);
    expect(runsOf(p, "", "make X")).toBeUndefined();
  });

  test("4: a lowercase makefile is read", async () => {
    const p = await extractProfile(
      await repoWith({
        "go.mod": "module x\n",
        "README.md": "Run `make test`.\n",
        makefile: "test:\n\tgo test ./...\n",
      }),
    );
    expect(runsOf(p, "", "make test")).toEqual(["go test ./..."]);
  });

  const released = (values: string[], release = "make release"): Profile => ({
    revision: "abcdef0123",
    format: 2,
    parts: [
      {
        folder: "",
        stacks: ["go"],
        commands: [
          { text: "make test", role: "check", source: "README.md:1" },
          { text: release, role: "release", source: "README.md:1" },
        ],
      },
      ...Array.from({ length: 12 }, (_, i) => ({
        folder: `svc${i}`,
        stacks: ["go"],
        commands: [
          { text: `go test ./svc${i}/...`, role: "check" as const, source: "README.md:1" },
        ],
      })),
      { folder: "deploy/chart", stacks: ["helm"], commands: [] },
    ],
    links: values.map((file) => ({
      value: "1.4.0",
      source: { folder: "", file: "Makefile", line: 1, key: "VERSION" },
      consumer: { folder: "deploy/chart", file, line: 5, key: "image.tag" },
      release: true,
    })),
    notes: [],
    shared: [],
  });
  const PLAN =
    "    plan: when tasks have parts: [orders-service], add a task that runs make release and depends on them, then a task with parts: [orders-service/deploy/chart] that sets image.tag and depends on the release";

  test("5: one plan line per release, worded by parts, kept within a tight budget", () => {
    const block = formatPartsBlock(
      "orders-service",
      released(["deploy/chart/values.yaml", "deploy/chart/values-prod.yaml"]),
      null,
      400,
    );
    expect(block.filter((l) => l.trimStart().startsWith("plan:"))).toEqual([PLAN]);
  });

  test("5: a long release command is clipped, so the plan line keeps its end", () => {
    const long =
      "docker push ghcr.io/acme/orders-service:latest --all-tags --quiet --platform linux/amd64";
    const [plan] = formatPartsBlock(
      "orders-service",
      released(["deploy/chart/values.yaml"], long),
      null,
    ).filter((l) => l.trimStart().startsWith("plan:"));
    expect(plan).toEndWith("depends on the release");
  });

  test("6: a profile stored before this format asks for a refresh", () => {
    const old: Profile = { ...released(["deploy/chart/values.yaml"]) };
    delete old.format;
    expect(formatPartsBlock("orders", old, null).join("\n")).toContain(
      "tell the user to run pm project refresh orders",
    );
    expect(formatPartsBlock("orders", released([]), null).join("\n")).not.toContain("refresh");
    const stored = readProfile(renderProfileSection("orders", released([])));
    expect(stored?.format).toBe(2);
  });
});
