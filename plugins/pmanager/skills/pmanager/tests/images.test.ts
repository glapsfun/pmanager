import { describe, expect, test } from "bun:test";
import { normalizeImage } from "../scripts/images";
import { extractProfile, formatPartsBlock, PROFILE_FORMAT, readProfile } from "../scripts/profile";
import { gitOk, initGitRepo, makeTempDir, writeTree } from "./helpers";

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir("images");
  await initGitRepo(dir);
  await writeTree(dir, files);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", "seed"], dir);
  return dir;
}

// A tag set from a variable pm cannot know.
const UNSET = "$" + "{TAG}";

const workflow = (on: string, steps: string, extra = "") => `name: release
on:
${on}
${extra}jobs:
  image:
    runs-on: ubuntu-latest
    steps:
${steps}`;

const META_STEPS = `      - uses: actions/checkout@v4
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/pm-example/storefront
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: \${{ steps.meta.outputs.tags }}
`;

describe("image releases", () => {
  test("build-push-action with metadata-action images, on a v* tag", async () => {
    const raw = workflow('  push:\n    tags: ["v*"]', META_STEPS);
    const p = await extractProfile(
      await repoWith({ "package.json": "{}", ".github/workflows/release.yml": raw }),
    );
    expect(p.releases).toEqual([
      {
        image: "ghcr.io/pm-example/storefront",
        trigger: { kind: "tag", pattern: "v*" },
        context: "",
        folder: "",
        source: `.github/workflows/release.yml:${raw.split("\n").findIndex((l) => l.includes("build-push-action")) + 1}`,
      },
    ]);
  });

  test("a branch push is a branch trigger; a build context names its part", async () => {
    const steps = META_STEPS.replace(
      "          push: true",
      "          context: services/api\n          push: true",
    );
    const p = await extractProfile(
      await repoWith({
        "services/api/package.json": "{}",
        "infra/main.tf": "",
        ".github/workflows/release.yml": workflow("  push:\n    branches: [main]", steps),
      }),
    );
    expect(p.releases[0]).toMatchObject({
      trigger: { kind: "branch", pattern: "main" },
      context: "services/api",
      folder: "services/api",
    });
  });

  test("the repo name, env values and matrix entries resolve; a secret does not", async () => {
    const steps = `      - run: docker push ghcr.io/\${{ github.repository }}:\${{ github.ref_name }}
      - run: docker push \${{ env.IMAGE }}:1
      - run: docker push ghcr.io/org/\${{ matrix.svc }}:1
      - run: docker push \${{ secrets.IMAGE }}:1
`;
    const raw = workflow(
      '  push:\n    tags: ["v*"]',
      steps,
      "env:\n  IMAGE: ghcr.io/x/y\n",
    ).replace(
      "    runs-on: ubuntu-latest\n",
      "    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        svc: [a, b]\n",
    );
    const p = await extractProfile(
      await repoWith({ "go.mod": "module x\n", ".github/workflows/release.yml": raw }),
      {
        url: "https://github.com/Org/Shop.git",
      },
    );
    expect(p.releases.map((r) => r.image)).toEqual([
      "ghcr.io/org/shop",
      "ghcr.io/x/y",
      "ghcr.io/org/a",
      "ghcr.io/org/b",
      null,
    ]);
    expect(p.releases[4]?.unresolved).toContain("secrets.IMAGE");
  });

  test("GitLab's $CI_REGISTRY_IMAGE needs the project's image-registry", async () => {
    const ci = `release:
  script:
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG
  rules:
    - if: $CI_COMMIT_TAG
`;
    const dir = await repoWith({ "go.mod": "module x\n", ".gitlab-ci.yml": ci });
    const withHost = await extractProfile(dir, {
      url: "https://gitlab.example.com/group/app.git",
      registry: "registry.example.com",
    });
    expect(withHost.releases[0]).toMatchObject({
      image: "registry.example.com/group/app",
      trigger: { kind: "tag", pattern: "*" },
    });
    const without = await extractProfile(dir, { url: "https://gitlab.example.com/group/app.git" });
    expect(without.releases[0]?.image).toBeNull();
    expect(without.releases[0]?.unresolved).toContain("image-registry");
  });
});

describe("image tag settings", () => {
  test("kustomize newTag, Helm values, Argo parameters and a workload image line", async () => {
    const dir = await repoWith({
      "workloads/storefront/kustomization.yaml":
        "resources:\n  - deployment.yaml\nimages:\n  - name: storefront\n    newName: ghcr.io/pm-example/storefront\n    newTag: 2.3.0\n",
      "workloads/storefront/deployment.yaml":
        "apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: storefront\n          image: storefront\n",
      "charts/api/values-prod.yaml": 'image:\n  repository: ghcr.io/x/api\n  tag: "1.2"\n',
      "apps/api.yaml":
        "apiVersion: argoproj.io/v1alpha1\nkind: Application\nspec:\n  source:\n    helm:\n      parameters:\n        - name: image.repository\n          value: ghcr.io/x/api\n        - name: image.tag\n          value: 1.2.0\n",
      "jobs/cron.yaml":
        "apiVersion: batch/v1\nkind: CronJob\nspec:\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n            - name: c\n              image: ghcr.io/x/cron:0.9\n",
      "workloads/other/kustomization.yaml": `images:\n  - name: ghcr.io/x/other\n    newTag: ${UNSET}\n`,
    });
    const p = await extractProfile(dir);
    const got = p.tagSettings
      .map((t) => [t.file, t.line, t.key, t.image, t.value, t.folder])
      .sort();
    expect(got).toEqual(
      [
        ["apps/api.yaml", 10, "image.tag", "ghcr.io/x/api", "1.2.0", ""],
        ["charts/api/values-prod.yaml", 3, "image.tag", "ghcr.io/x/api", "1.2", ""],
        ["jobs/cron.yaml", 10, "image", "ghcr.io/x/cron", "0.9", ""],
        [
          "workloads/other/kustomization.yaml",
          3,
          "newTag",
          "ghcr.io/x/other",
          UNSET,
          "workloads/other",
        ],
        [
          "workloads/storefront/kustomization.yaml",
          6,
          "newTag",
          "ghcr.io/pm-example/storefront",
          "2.3.0",
          "workloads/storefront",
        ],
      ].sort(),
    );
  });
});

describe("normalizeImage and the stored format", () => {
  test("defaults made explicit, tag and digest dropped, lowercased", () => {
    expect(normalizeImage("node:20")).toBe("docker.io/library/node");
    expect(normalizeImage("bitnami/redis:7")).toBe("docker.io/bitnami/redis");
    expect(normalizeImage("ghcr.io/X/Y:1@sha256:ab")).toBe("ghcr.io/x/y");
    expect(normalizeImage("localhost:5000/app:1")).toBe("localhost:5000/app");
  });

  test("format 3 stores releases and tag settings; an older profile reads back with none and is stale", async () => {
    expect(PROFILE_FORMAT).toBe(3);
    const old = readProfile(
      '<!-- pm:parts:start -->\n```json\n{"revision":"abc1234","format":2,"parts":[],"links":[],"notes":[],"shared":[]}\n```\n<!-- pm:parts:end -->',
    );
    expect(old?.releases).toEqual([]);
    expect(old?.tagSettings).toEqual([]);
    expect(formatPartsBlock("x", old as NonNullable<typeof old>, null).join("\n")).toContain(
      "stored by an older pm",
    );
  });
});
