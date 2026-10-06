import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildLock, checkPin, LOCK_FILE } from "../../scripts/design-system/lib.mjs";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const temps: string[] = [];
afterEach(() => temps.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function write(root: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

/** Publishes a fake release into a fake repo's design-system workspace. */
function publish(root: string, version: string, files: Record<string, string>, status = "published") {
  const dir = `design-system/releases/v${version}`;
  for (const [f, c] of Object.entries(files)) write(root, `${dir}/files/${f}`, c);
  write(root, `${dir}/modules.json`, JSON.stringify({ watch: ["src/components/ui"] }));
  const checksums = Object.entries(files)
    .map(([f, c]) => `${sha(c)}  files/${f}`)
    .join("\n");
  write(root, `${dir}/checksums.sha256`, checksums);
  const manifestPath = path.join(root, "design-system/releases/manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { schema: 1, active: version, releases: [] };
  manifest.releases.push({
    version,
    status,
    checksum: sha(checksums),
    modules: { buttons: { version, files: Object.fromEntries(Object.entries(files).map(([f, c]) => [f, sha(c)])) } },
  });
  write(root, "design-system/releases/manifest.json", JSON.stringify(manifest));
}

function fakeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-pin-"));
  temps.push(root);
  write(
    root,
    "postcss.config.mjs",
    `export default { plugins: { "@tailwindcss/postcss": { base: ${JSON.stringify(path.join(root, "src"))} } } };`,
  );
  write(root, "src/components/ui/button.tsx", "v1");
  publish(root, "1.0.0", { "src/components/ui/button.tsx": "v1" });
  fs.writeFileSync(
    path.join(root, LOCK_FILE),
    JSON.stringify(buildLock(root, "1.0.0", { authorizedBy: "Aman", reason: "initial" })),
  );
  return root;
}

describe("design-system pin (app side)", () => {
  it("the real app matches its pinned release", async () => {
    const r = await checkPin(process.cwd(), {
      mode: process.env.DS_PIN_MODE === "candidate" ? "candidate" : "enforce",
    });
    expect(r.errors).toEqual([]);
    expect(r.lock?.release).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("passes on a clean pinned tree", async () => {
    const root = fakeRepo();
    expect((await checkPin(root)).errors).toEqual([]);
  });

  it("blocks a changed, deleted or unreleased design-system file", async () => {
    const root = fakeRepo();
    write(root, "src/components/ui/button.tsx", "experimental");
    write(root, "src/components/ui/new-thing.tsx", "x");
    const r = await checkPin(root);
    expect(r.errors.join("\n")).toMatch(/button\.tsx differs/);
    expect(r.errors.join("\n")).toMatch(/new-thing\.tsx is not part of design-system v1\.0\.0/);
    // Disposable copies validating a candidate report without blocking.
    expect((await checkPin(root, { mode: "candidate" })).errors).toEqual([]);
  });

  it("blocks imports from the design-system workspace and an unscoped Tailwind scan", async () => {
    const root = fakeRepo();
    write(root, "src/app/page.tsx", `import { X } from "../../design-system/experiments/x/specimens";`);
    write(root, "postcss.config.mjs", `export default { plugins: { "@tailwindcss/postcss": {} } };`);
    const r = await checkPin(root);
    expect(r.errors.join("\n")).toMatch(/imports from design-system/);
    expect(r.errors.join("\n")).toMatch(/limit Tailwind's source scan/);
  });

  it("ignores the workspace's 'active' pointer: a newer published release isn't adopted", async () => {
    const root = fakeRepo();
    publish(root, "1.1.0", { "src/components/ui/button.tsx": "v2" });
    const manifestPath = path.join(root, "design-system/releases/manifest.json");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...m, active: "1.1.0" }));
    const r = await checkPin(root);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join("\n")).toMatch(/app stays on v1\.0\.0/);
  });

  it("pins only an exact, published, untampered release that is already in place, with an authorization", async () => {
    const root = fakeRepo();
    publish(root, "1.1.0", { "src/components/ui/button.tsx": "v2" });
    publish(root, "1.2.0", { "src/components/ui/button.tsx": "v3" }, "candidate");
    expect(() => buildLock(root, "latest", { authorizedBy: "Aman" })).toThrow(/exact version/);
    expect(() => buildLock(root, "1.2.0", { authorizedBy: "Aman" })).toThrow(/not published/);
    expect(() => buildLock(root, "1.1.0", { authorizedBy: "" })).toThrow(/authorized-by/);
    expect(() => buildLock(root, "1.1.0", { authorizedBy: "Aman" })).toThrow(/doesn't contain v1\.1\.0 yet/);

    write(root, "src/components/ui/button.tsx", "v2"); // what `ds.mjs adopt 1.1.0` does
    const upgraded = buildLock(root, "1.1.0", { authorizedBy: "Aman", reason: "touch targets" });
    expect(upgraded).toMatchObject({ release: "1.1.0", previous: { release: "1.0.0" } });
    expect(upgraded.history.map((h) => h.action)).toEqual(["pin", "upgrade"]);
    fs.writeFileSync(path.join(root, LOCK_FILE), JSON.stringify(upgraded));
    expect((await checkPin(root)).errors).toEqual([]);

    // Rollback path: restore the files, then pin the earlier release.
    write(root, "src/components/ui/button.tsx", "v1");
    const back = buildLock(root, "1.0.0", { authorizedBy: "Aman", reason: "rollback" });
    expect(back.history.at(-1)!.action).toBe("rollback");

    // A published release that was altered afterwards can't be pinned.
    write(root, "design-system/releases/v1.1.0/files/src/components/ui/button.tsx", "tampered");
    expect(() => buildLock(root, "1.1.0", { authorizedBy: "Aman" })).toThrow(/doesn't match its hash/);
  });
});
