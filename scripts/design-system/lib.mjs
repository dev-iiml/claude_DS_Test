/**
 * Design-system pin — app side (no dependencies; Node ≥ 20).
 *
 * The app runs one explicit, published design-system release, recorded in
 * `design-system.lock.json` (app-owned, outside `design-system/`). The lock
 * embeds every release file's SHA-256, so the pin holds even if the
 * design-system workspace (experiments, candidates, its manifest's `active`
 * pointer) changes. Nothing here ever picks "latest", a candidate or a draft.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const LOCK_FILE = "design-system.lock.json";
export const MANIFEST = "design-system/releases/manifest.json";
const SEMVER = /^\d+\.\d+\.\d+$/;

export const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Files that ship in the app (everything except the design-system workspace's own copies and tests). */
export const isRuntimeFile = (p) => !p.startsWith("design-system/") && !p.startsWith("tests/");

export function readLock(root) {
  const file = path.join(root, LOCK_FILE);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listFiles(root, dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    return e.isDirectory() ? listFiles(root, rel) : [rel];
  });
}

/** Does the Tailwind build scan only `src/` (so design-system files can't add classes to the app's CSS)? */
export async function tailwindScansSrcOnly(root) {
  const mod = await import(path.join(root, "postcss.config.mjs"));
  const base = mod.default?.plugins?.["@tailwindcss/postcss"]?.base;
  return typeof base === "string" && path.resolve(root, base) === path.resolve(root, "src");
}

/**
 * Compares the working tree with the pinned release.
 * Returns { errors, warnings, info } — strings for people, no file contents.
 */
export async function checkPin(root, { mode = "enforce" } = {}) {
  const errors = [];
  const warnings = [];
  const info = [];
  const lock = readLock(root);
  if (!lock)
    return {
      errors: [`${LOCK_FILE} is missing — the app must be pinned to a design-system release.`],
      warnings,
      info,
      lock,
    };
  if (!SEMVER.test(lock.release ?? ""))
    errors.push(`${LOCK_FILE}: "release" must be an exact version, got "${lock.release}".`);

  // 1. Every pinned file is byte-identical.
  for (const [file, hash] of Object.entries(lock.files ?? {})) {
    const abs = path.join(root, file);
    const problem = !fs.existsSync(abs)
      ? "is missing"
      : sha256(abs) !== hash
        ? "differs from the pinned release"
        : null;
    if (!problem) continue;
    (isRuntimeFile(file) ? errors : warnings).push(`${file} ${problem} (v${lock.release}).`);
  }
  // 2. No design-system files outside the release.
  const pinned = new Set(Object.keys(lock.files ?? {}));
  for (const dir of lock.watch ?? []) {
    for (const file of listFiles(root, dir)) {
      if (!pinned.has(file)) errors.push(`${file} is not part of design-system v${lock.release}.`);
    }
  }
  // 3. Generated CSS can't pick up class names from the design-system workspace.
  if (!(await tailwindScansSrcOnly(root)))
    errors.push(`postcss.config.mjs must limit Tailwind's source scan to src/ (base: "src").`);

  // 4. The app never imports from the design-system workspace (experiments, candidates, previews).
  const importRe =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|@import\s+|@source\s+|@plugin\s+|@config\s+)["'][^"']*design-system\//;
  for (const file of listFiles(root, "src").filter((f) => /\.(c|m)?[jt]sx?$|\.css$/.test(f))) {
    if (importRe.test(fs.readFileSync(path.join(root, file), "utf8")))
      errors.push(`${file} imports from design-system/ — the app may only use the pinned files in src/.`);
  }

  // 5. Cross-check the published release, when the design-system workspace is present.
  const manifestFile = path.join(root, MANIFEST);
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const entry = (manifest.releases ?? []).find((r) => r.version === lock.release);
    if (!entry) errors.push(`Pinned release v${lock.release} is not in ${MANIFEST}.`);
    else {
      if (entry.status !== "published")
        errors.push(`Pinned release v${lock.release} is "${entry.status}", not published.`);
      if (entry.checksum !== lock.releaseChecksum)
        errors.push(`Published v${lock.release} no longer matches the pin (release checksum changed).`);
    }
    if (manifest.active && manifest.active !== lock.release)
      warnings.push(
        `The design-system workspace marks v${manifest.active} active; the app stays on v${lock.release} until an authorized upgrade is pinned.`,
      );
  } else {
    info.push("design-system workspace not present here; checked against the hashes in the lock.");
  }

  if (mode === "candidate") {
    // Disposable copies validating a candidate release: report, never block.
    return { errors: [], warnings: [...errors.map((e) => `[candidate] ${e}`), ...warnings], info, lock };
  }
  if (mode === "warn") return { errors: [], warnings: [...errors, ...warnings], info, lock };
  return { errors, warnings, info, lock };
}

/** Verifies a published release on disk and returns its record (never a candidate or draft). */
export function loadPublishedRelease(root, version) {
  if (!SEMVER.test(version ?? ""))
    throw new Error(`Give an exact version like 2.1.0 (got "${version}"). "latest" is never used.`);
  const manifestFile = path.join(root, MANIFEST);
  if (!fs.existsSync(manifestFile))
    throw new Error(`${MANIFEST} not found — run this where the design-system workspace is.`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const entry = (manifest.releases ?? []).find((r) => r.version === version);
  if (!entry)
    throw new Error(`v${version} is not a release in ${MANIFEST} (candidates and experiments can't be pinned).`);
  if (entry.status !== "published") throw new Error(`v${version} is "${entry.status}", not published.`);
  const dir = path.join(root, "design-system/releases", `v${version}`);
  if (sha256(path.join(dir, "checksums.sha256")) !== entry.checksum)
    throw new Error(`v${version}'s checksums.sha256 doesn't match the manifest — the release was altered.`);
  const files = {};
  for (const mod of Object.values(entry.modules)) {
    for (const [file, hash] of Object.entries(mod.files)) {
      const copy = path.join(dir, "files", file);
      if (!fs.existsSync(copy) || sha256(copy) !== hash)
        throw new Error(`v${version}: ${file} in the release doesn't match its hash.`);
      files[file] = hash;
    }
  }
  const modules = Object.fromEntries(Object.entries(entry.modules).map(([k, m]) => [k, m.version]));
  const ownership = JSON.parse(fs.readFileSync(path.join(dir, "modules.json"), "utf8"));
  return { entry, files, modules, watch: ownership.watch ?? [] };
}

/** Builds the new lock for an authorized pin, after the release's files are in the working tree. */
export function buildLock(root, version, { authorizedBy, reason, now = new Date() }) {
  if (!authorizedBy?.trim()) throw new Error(`Pinning needs --authorized-by "<name>".`);
  const { entry, files, modules, watch } = loadPublishedRelease(root, version);
  const differs = Object.entries(files).filter(
    ([f, h]) => !fs.existsSync(path.join(root, f)) || sha256(path.join(root, f)) !== h,
  );
  if (differs.length)
    throw new Error(
      `The working tree doesn't contain v${version} yet (${differs.length} files differ, e.g. ${differs[0][0]}). ` +
        `Run: node design-system/versioning/ds.mjs adopt ${version} --authorized-by "<name>" (or rollback), then pin.`,
    );
  const previous = readLock(root);
  const action = !previous
    ? "pin"
    : compareVersions(version, previous.release) < 0
      ? "rollback"
      : version === previous.release
        ? "re-pin"
        : "upgrade";
  return {
    $comment:
      "Design-system release this app runs. App-owned; changed only by `npm run ds:pin` with an authorization. Never 'latest', a candidate or a draft. See docs/DESIGN_SYSTEM.md.",
    schema: 1,
    release: version,
    releaseChecksum: entry.checksum,
    source: `design-system/releases/v${version}`,
    pinnedAt: now.toISOString(),
    authorizedBy: authorizedBy.trim(),
    reason: reason?.trim() || null,
    previous: previous ? { release: previous.release, releaseChecksum: previous.releaseChecksum } : null,
    modules,
    watch,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    history: [
      ...(previous?.history ?? []),
      { action, release: version, at: now.toISOString(), by: authorizedBy.trim(), reason: reason?.trim() || null },
    ],
  };
}

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
