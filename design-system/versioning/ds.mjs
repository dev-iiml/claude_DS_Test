#!/usr/bin/env node
/**
 * CreatorCo design-system versioning.
 *
 *   node design-system/versioning/ds.mjs <command> [options]
 *
 * Commands
 *   status                                   Active release, releases, experiments and approvals.
 *   verify [--strict]                        Release integrity (immutability), manifest, drift of the active files, experiment patches.
 *   release <version> --from-active          Snapshot the files the app uses now as a published release (baseline / patch capture).
 *           [--notes <file.md>] [--summary <text>]
 *   approve <id> --by <name> [--note <text>] Record an approval decision (also: reject, reset).
 *   preview <id|all> [--png]                 Build before/after preview.html (and before-after.png) for an experiment.
 *   compose <version> [--base <v>] [--check] [--full]
 *                                            Combine ONLY approved experiments with unchanged baseline modules into a candidate.
 *   publish <version>                        Freeze a candidate as an immutable published release.
 *   adopt <version> --authorized-by <name> [--reason <text>]
 *                                            Copy a published release into src/ (changes the active version). Never run without authorization.
 *   rollback <version> --authorized-by <name> [--reason <text>]
 *                                            Re-adopt an earlier published release.
 *   workspace <id> [--dir <path>]            Authoring: materialise base + required experiments (+ this one) outside the repo.
 *   save <id> --dir <path>                   Authoring: write the workspace changes as the experiment's changes.patch.
 *
 * Nothing in experiments/ or releases/ is imported by the app. Only `adopt` and `rollback` write to src/.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = path.resolve(HERE, "..");
const REPO = path.resolve(DS, "..");
const REL = path.join(DS, "releases");
const EXP = path.join(DS, "experiments");
const MANIFEST = path.join(REL, "manifest.json");
const APPROVALS = path.join(EXP, "approvals.json");
const MODULES = path.join(HERE, "modules.json");

/* ---------------- small helpers ---------------- */

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const sha = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const rel = (p) => path.relative(REPO, p) || ".";
const exists = (p) => fs.existsSync(p);
const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });
const copy = (a, b) => {
  mkdirp(path.dirname(b));
  fs.copyFileSync(a, b);
};
function die(msg, code = 1) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(code);
}
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}
function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const semver = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) die(`"${v}" is not a version like 2.1.0`);
  return m.slice(1).map(Number);
};
const cmpVer = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const bumpVer = (v, kind) => {
  const [M, m, p] = semver(v);
  return kind === "major" ? `${M + 1}.0.0` : kind === "minor" ? `${M}.${m + 1}.0` : `${M}.${m}.${p + 1}`;
};

/* ---------------- model ---------------- */

function moduleMap(file = MODULES) {
  return readJson(file);
}
function filesOf(map) {
  const out = [];
  for (const [id, m] of Object.entries(map.modules)) {
    for (const f of m.files) out.push({ path: f, module: id, generated: false });
    for (const f of m.generated ?? []) out.push({ path: f, module: id, generated: true });
  }
  return out;
}
const ownerOf = (map, file) => filesOf(map).find((f) => f.path === file)?.module ?? null;

function manifest() {
  return exists(MANIFEST) ? readJson(MANIFEST) : { schema: 1, active: null, releases: [], history: [] };
}
const releaseDir = (v) => path.join(REL, `v${v}`);
const candidateDir = (v) => path.join(REL, "candidates", `v${v}`);
function releaseEntry(man, v) {
  return man.releases.find((r) => r.version === v);
}
function approvals() {
  return exists(APPROVALS) ? readJson(APPROVALS) : {};
}
function experiments() {
  const out = [];
  if (!exists(EXP)) return out;
  for (const mod of fs.readdirSync(EXP)) {
    const md = path.join(EXP, mod);
    if (!fs.statSync(md).isDirectory()) continue;
    for (const id of fs.readdirSync(md)) {
      const f = path.join(md, id, "experiment.json");
      if (exists(f)) out.push({ ...readJson(f), dir: path.join(md, id) });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
function experiment(id) {
  const e = experiments().find((x) => x.id === id);
  if (!e) die(`No experiment "${id}". Run: ds.mjs status`);
  return e;
}
/** Requires-closure in apply order (dependencies first). */
function closure(id, seen = new Set(), order = []) {
  const e = experiment(id);
  for (const r of e.requires ?? []) if (!seen.has(r.id)) closure(r.id, seen, order);
  if (!seen.has(id)) {
    seen.add(id);
    order.push(id);
  }
  return order;
}
/** Files a patch touches: [{path, kind: "modify"|"add"|"delete"}]. */
function patchFiles(patchPath) {
  if (!exists(patchPath)) return [];
  const txt = fs.readFileSync(patchPath, "utf8");
  const out = [];
  for (const block of txt.split(/^diff --git /m).slice(1)) {
    const m = /^a\/(\S+) b\/(\S+)/.exec(block);
    if (!m) continue;
    const kind = /^new file mode/m.test(block) ? "add" : /^deleted file mode/m.test(block) ? "delete" : "modify";
    out.push({ path: kind === "delete" ? m[1] : m[2], kind });
  }
  return out;
}

/* ---------------- trees ---------------- */

const TREE_ENTRIES = [
  "src",
  "tests",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "next-env.d.ts",
  "eslint.config.mjs",
  "vitest.config.mts",
  "postcss.config.mjs",
  "components.json",
  ".prettierrc.json",
  ".prettierignore",
  "design-system/tokens.json",
  "design-system/viewer",
];

/**
 * A disposable copy of the repo (outside it) with a release's files laid over the working copy and the
 * given experiment patches applied — i.e. what the repo would look like after adopting. node_modules is
 * symlinked. Used for previews, compose checks and authoring workspaces.
 */
function materialize(baseVersion, ids, dir) {
  const base = releaseDir(baseVersion);
  if (!exists(path.join(base, "files"))) die(`Release ${baseVersion} has no files at ${rel(base)}`);
  const tmp = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "ds-tree-"));
  mkdirp(tmp);
  for (const e of TREE_ENTRIES) {
    const s = path.join(REPO, e);
    if (exists(s)) fs.cpSync(s, path.join(tmp, e), { recursive: true });
  }
  if (!exists(path.join(tmp, "node_modules")))
    fs.symlinkSync(fs.realpathSync(path.join(REPO, "node_modules")), path.join(tmp, "node_modules"), "dir");
  // env files are linked, not copied, so integration tests can reach the (separate) test database
  for (const env of [".env", ".env.local"])
    if (exists(path.join(REPO, env)) && !exists(path.join(tmp, env)))
      fs.symlinkSync(path.join(REPO, env), path.join(tmp, env));
  // lay the base release over the working copy
  const relMap = moduleMap(path.join(base, "modules.json"));
  for (const f of filesOf(relMap)) copy(path.join(base, "files", f.path), path.join(tmp, f.path));
  for (const id of ids) {
    const p = path.join(experiment(id).dir, "changes.patch");
    if (!exists(p)) continue;
    const r = run("git", ["apply", "--whitespace=nowarn", "-p1", p], { cwd: tmp });
    if (r.code !== 0) {
      const err = new Error(`patch for ${id} does not apply:\n${r.out.trim()}`);
      err.experiment = id;
      err.files = patchFiles(p).map((x) => x.path);
      throw err;
    }
  }
  return tmp;
}
function driftExtraFiles(map, root) {
  const known = new Set(filesOf(map).map((f) => f.path));
  const out = [];
  for (const w of map.watch ?? []) {
    const d = path.join(root, w);
    if (!exists(d)) continue;
    for (const f of fs.readdirSync(d, { recursive: true })) {
      const p = path.join(w, f);
      if (fs.statSync(path.join(root, p)).isFile() && !known.has(p)) out.push(p);
    }
  }
  return out;
}
/**
 * node_modules in a composed tree is a symlink into the repo, and Turbopack only resolves inside its
 * root. For the build check the tree's next.config is wrapped to widen turbopack.root to the common
 * parent; the app's own config is otherwise unchanged (and the repo's file is never touched).
 */
function widenTurbopackRoot(tree) {
  const cfg = path.join(tree, "next.config.ts");
  if (!exists(cfg)) return;
  const modules = fs.realpathSync(path.join(REPO, "node_modules"));
  let root = tree;
  while (!modules.startsWith(root + path.sep) && root !== path.dirname(root)) root = path.dirname(root);
  fs.renameSync(cfg, path.join(tree, "next.config.base.ts"));
  fs.writeFileSync(
    cfg,
    `import base from "./next.config.base";\n\nconst config = { ...base, turbopack: { ...(base.turbopack ?? {}), root: ${JSON.stringify(root)} } };\nexport default config;\n`,
  );
}
function regenerate(tree) {
  const r = run("npm", ["run", "--silent", "tokens"], { cwd: tree });
  if (r.code !== 0) throw new Error(`npm run tokens failed in the composed tree:\n${r.out}`);
}

/* ---------------- verify ---------------- */

function checksums(dir) {
  const lines = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f !== "checksums.sha256") lines.push(`${sha(p)}  ${path.relative(dir, p)}`);
    }
  };
  walk(dir);
  return lines.join("\n") + "\n";
}
function verifyRelease(entry) {
  const dir = releaseDir(entry.version);
  const problems = [];
  if (!exists(dir)) return [`release directory ${rel(dir)} is missing`];
  const file = path.join(dir, "checksums.sha256");
  if (!exists(file)) return [`${rel(file)} is missing`];
  const recorded = fs.readFileSync(file, "utf8");
  if (sha(file) !== entry.checksum) problems.push("checksums.sha256 itself was edited");
  if (checksums(dir) !== recorded) {
    const want = new Map(
      recorded
        .trim()
        .split("\n")
        .map((l) => l.split("  ").reverse()),
    );
    const have = new Map(
      checksums(dir)
        .trim()
        .split("\n")
        .map((l) => l.split("  ").reverse()),
    );
    for (const [p, h] of want) if (have.get(p) !== h) problems.push(`${p} ${have.has(p) ? "changed" : "missing"}`);
    for (const p of have.keys()) if (!want.has(p)) problems.push(`${p} added after publication`);
  }
  for (const [mid, m] of Object.entries(entry.modules))
    for (const [p, h] of Object.entries(m.files))
      if (!exists(path.join(dir, "files", p)) || sha(path.join(dir, "files", p)) !== h)
        problems.push(`${p} (module ${mid}) does not match the manifest`);
  return problems;
}
function activeDrift(man) {
  if (!man.active) return { changed: [], missing: [], extra: [] };
  const entry = releaseEntry(man, man.active);
  const map = moduleMap(path.join(releaseDir(man.active), "modules.json"));
  const changed = [];
  const missing = [];
  for (const m of Object.values(entry.modules))
    for (const [p, h] of Object.entries(m.files)) {
      const f = path.join(REPO, p);
      if (!exists(f)) missing.push(p);
      else if (sha(f) !== h) changed.push(p);
    }
  return { changed, missing, extra: driftExtraFiles(map, REPO) };
}
function cmdVerify(o) {
  const man = manifest();
  let errors = 0;
  console.log("Release integrity");
  for (const r of man.releases.filter((x) => x.status === "published")) {
    const p = verifyRelease(r);
    console.log(`  ${p.length ? "✗" : "✓"} v${r.version}${p.length ? "\n      " + p.join("\n      ") : ""}`);
    errors += p.length;
  }
  if (!man.releases.length) console.log("  (no releases yet)");
  const d = activeDrift(man);
  const drift = d.changed.length + d.missing.length + d.extra.length;
  console.log(`\nActive files vs v${man.active}`);
  if (!drift) console.log("  ✓ src/ matches the active release exactly");
  else {
    for (const p of d.changed) console.log(`  ~ ${p}  (changed since v${man.active})`);
    for (const p of d.missing) console.log(`  - ${p}  (missing)`);
    for (const p of d.extra) console.log(`  + ${p}  (not in any module)`);
    console.log(
      `\n  These are unreleased changes made directly in src/. They are kept as they are. To record them,\n  cut a patch release: ds.mjs release ${bumpVer(man.active, "patch")} --from-active  (assign new files in modules.json first).`,
    );
  }
  console.log("\nExperiments");
  const ap = approvals();
  for (const e of experiments()) {
    let ok = true;
    let msg = "";
    try {
      const t = materialize(e.base, closure(e.id));
      fs.rmSync(t, { recursive: true, force: true });
    } catch (err) {
      ok = false;
      msg = err.message.split("\n")[0];
    }
    if (!ap[e.id]) msg += " (missing from approvals.json)";
    console.log(`  ${ok ? "✓" : "✗"} ${e.id} — applies to v${e.base}${msg ? " · " + msg : ""}`);
    if (!ok) errors++;
  }
  if (errors) die(`${errors} integrity problem(s).`, 1);
  if (drift && o.strict) die("Active files drifted from the active release (--strict).", 2);
  console.log("\n✓ verify passed" + (drift ? " (with unreleased changes, see above)" : ""));
}

/* ---------------- status ---------------- */

function cmdStatus() {
  const man = manifest();
  const ap = approvals();
  console.log(`Active release: ${man.active ? "v" + man.active : "(none)"}`);
  console.log("\nReleases");
  for (const r of man.releases)
    console.log(`  v${r.version.padEnd(8)} ${r.status.padEnd(10)} ${r.date}  ${r.summary ?? ""}`);
  const cands = exists(path.join(REL, "candidates")) ? fs.readdirSync(path.join(REL, "candidates")) : [];
  for (const c of cands) console.log(`  ${c.padEnd(9)} candidate   (not published)`);
  console.log("\nExperiments");
  for (const e of experiments()) {
    const a = ap[e.id] ?? { decision: "proposed" };
    const req = (e.requires ?? []).map((r) => r.id).join(", ");
    console.log(
      `  ${a.decision.padEnd(9)} ${e.id.padEnd(34)} ${e.module.padEnd(14)} ${req ? "requires " + req : "standalone"}${a.releasedIn ? " · in v" + a.releasedIn : ""}`,
    );
  }
}

/* ---------------- approvals ---------------- */

function cmdDecide(decision, o) {
  const id = o._[1];
  if (!id) die(`Usage: ds.mjs ${decision} <experiment-id> --by <name>`);
  experiment(id);
  if (decision !== "reset" && typeof o.by !== "string") die("Say who decided: --by <name>");
  const ap = approvals();
  ap[id] =
    decision === "reset"
      ? { decision: "proposed" }
      : {
          decision: decision === "approve" ? "approved" : "rejected",
          by: o.by,
          date: today(),
          note: o.note === true ? "" : (o.note ?? ""),
        };
  writeJson(APPROVALS, ap);
  console.log(`${id}: ${ap[id].decision}`);
  if (decision === "approve") {
    const missing = closure(id).filter((x) => x !== id && ap[x]?.decision !== "approved");
    if (missing.length)
      console.log(
        `  note: ${id} cannot be released without ${missing.join(", ")} — approve those too, or compose will refuse.`,
      );
  }
}

/* ---------------- release (from active) ---------------- */

function writeRelease(dir, version, map, fileSource, entryExtra, notes) {
  mkdirp(dir);
  const modules = {};
  for (const [id, m] of Object.entries(map.modules)) {
    modules[id] = { version: entryExtra.moduleVersions?.[id] ?? version, title: m.title, files: {} };
    for (const f of [...m.files, ...(m.generated ?? [])]) {
      const src = fileSource(f);
      if (!exists(src)) die(`${f} (module ${id}) does not exist — cannot release`);
      copy(src, path.join(dir, "files", f));
      modules[id].files[f] = sha(src);
    }
  }
  writeJson(path.join(dir, "modules.json"), map);
  fs.writeFileSync(path.join(dir, "RELEASE.md"), notes);
  fs.writeFileSync(path.join(dir, "checksums.sha256"), checksums(dir));
  const { moduleVersions: _mv, ...rest } = entryExtra;
  return {
    version,
    ...rest,
    modules,
    notes: rel(path.join(dir, "RELEASE.md")),
    checksum: sha(path.join(dir, "checksums.sha256")),
  };
}
function cmdRelease(o) {
  const version = o._[1];
  semver(version ?? "");
  if (!o["from-active"])
    die("Only `release <version> --from-active` is supported; new versions come from compose + publish.");
  const man = manifest();
  if (releaseEntry(man, version) || exists(releaseDir(version)))
    die(`v${version} already exists — published releases are immutable.`);
  if (man.active && cmpVer(version, man.active) <= 0)
    die(`v${version} must be greater than the active v${man.active}.`);
  const map = moduleMap();
  const d = man.active ? activeDrift(man) : null;
  if (d?.extra.length)
    die(`Assign these files to a module in versioning/modules.json first:\n  ${d.extra.join("\n  ")}`);
  const prev = man.active ? releaseEntry(man, man.active) : null;
  const moduleVersions = {};
  for (const [id, m] of Object.entries(map.modules)) {
    const same =
      prev && [...m.files, ...(m.generated ?? [])].every((f) => prev.modules[id]?.files[f] === sha(path.join(REPO, f)));
    moduleVersions[id] = same ? prev.modules[id].version : version;
  }
  const notes = o.notes
    ? fs.readFileSync(path.resolve(o.notes), "utf8")
    : `# v${version}\n\n${o.summary ?? "Snapshot of the active design-system files."}\n`;
  const entry = writeRelease(
    releaseDir(version),
    version,
    map,
    (f) => path.join(REPO, f),
    { status: "published", date: today(), base: man.active, summary: o.summary ?? "", experiments: [], moduleVersions },
    notes,
  );
  man.releases.push(entry);
  man.history.push({
    action: man.active ? "release-from-active" : "formalize",
    version,
    at: now(),
    by: o.by ?? "",
    note: o.summary ?? "",
  });
  man.active = version;
  writeJson(MANIFEST, man);
  console.log(
    `✓ Published v${version} from the active files (${Object.values(entry.modules).reduce((n, m) => n + Object.keys(m.files).length, 0)} files). Active: v${version}. src/ was not changed.`,
  );
}

/* ---------------- preview ---------------- */

async function bundle(tree, { extraSpecimens, globalName }) {
  const { build } = await import("esbuild");
  const postcss = (await import("postcss")).default;
  const tailwind = (await import("@tailwindcss/postcss")).default;
  const viewer = path.join(tree, "design-system/viewer/src");
  const entry = path.join(tree, "ds-preview-entry.tsx");
  fs.writeFileSync(
    entry,
    `import * as React from "react";
import { createRoot } from "react-dom/client";
import { mount as baseMount } from "./design-system/viewer/src/specimens";
${extraSpecimens ? `import { SHARED, AFTER } from "./ds-preview-extra";\nconst EXTRA = { ...(SHARED ?? {}), ...(${extraSpecimens === "after" ? "AFTER ?? {}" : "{}"}) };` : "const EXTRA = {};"}
export function mount(name: string, el: HTMLElement) {
  const S = (EXTRA as Record<string, () => React.ReactNode>)[name];
  if (S) { createRoot(el).render(<S />); return; }
  baseMount(name, el);
}
`,
  );
  const shim = (f) => path.join(viewer, "shims", f);
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    write: false,
    format: "iife",
    globalName,
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    nodePaths: [path.join(REPO, "node_modules")],
    legalComments: "none",
    logLevel: "error",
    plugins: [
      {
        name: "alias",
        setup(b) {
          b.onResolve({ filter: /^@\// }, (a) =>
            b.resolve("./" + a.path.slice(2), { resolveDir: path.join(tree, "src"), kind: a.kind }),
          );
          b.onResolve({ filter: /^next\/link$/ }, () => ({ path: shim("next-link.tsx") }));
          b.onResolve({ filter: /^(next\/navigation|server-only)$/ }, () => ({ path: shim("next-navigation.ts") }));
        },
      },
    ],
  });
  const js = out.outputFiles[0].text;
  const globals = fs.readFileSync(path.join(tree, "src/app/globals.css"), "utf8");
  const input = [
    '@import "tailwindcss" source(none);',
    `@source "${path.join(tree, "src/components")}";`,
    `@source "${viewer}";`,
    extraSpecimens ? `@source "${path.join(tree, "ds-preview-extra.tsx")}";` : "",
    globals
      .replace(/^@import "tailwindcss";\s*$/m, "")
      .replace('@import "./tokens.css";', `@import "${path.join(tree, "src/app/tokens.css")}";`),
  ].join("\n");
  const css = (
    await postcss([tailwind({ base: tree, optimize: { minify: true } })]).process(input, {
      from: path.join(tree, "src/app/globals.css"),
    })
  ).css;
  if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error("bundle contains a closing tag");
  return { js, css };
}
/** Product fonts, plus preview-only faces an experiment declares (applied to BOTH sides). */
function fontCss(e) {
  const FS = path.join(REPO, "node_modules/@fontsource-variable");
  const face = (fam, file, w, range) =>
    `@font-face{font-family:"${fam}";font-weight:${w};font-display:swap;${range ? `unicode-range:${range};` : ""}src:url(data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}) format("woff2")}`;
  return [
    face("Inter Variable", path.join(FS, "inter/files/inter-latin-wght-normal.woff2"), "100 900"),
    face("Newsreader Variable", path.join(FS, "newsreader/files/newsreader-latin-wght-normal.woff2"), "200 800"),
    ...(e.preview.fonts ?? []).map((f) => face(f.family, path.join(e.dir, f.file), f.weight ?? "400", f.unicodeRange)),
  ].join("");
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function previewHtml(e, before, after, req) {
  const rows = e.preview.compare
    .map(
      (c, i) => `<section class="cmp"><h2>${esc(c.title)}</h2>${c.note ? `<p class="note">${esc(c.note)}</p>` : ""}
      <div class="pair">
        <figure><figcaption>Before · v${e.base}</figcaption>${c.before ? `<div class="spec" data-side="before" data-name="${c.before}" data-w="${c.width ?? 760}"></div>` : `<div class="none">Not in v${e.base}</div>`}</figure>
        <figure><figcaption>After · ${esc(e.id)}</figcaption><div class="spec" data-side="after" data-name="${c.after}" data-w="${c.width ?? 760}"></div></figure>
      </div></section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en-IN" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(e.id)} — before / after</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#0b0b0d;color:#f5f5f7;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Inter Variable",system-ui,sans-serif}
[data-theme=light] body{background:#f2f2f7;color:#1c1c1e}
header.top{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:14px 24px;border-bottom:1px solid #2a2a2e;background:inherit}
[data-theme=light] header.top{border-color:#e3e3e8}
h1{font-size:20px;margin:0}h2{font-size:17px;margin:0 0 6px}
.pill{border-radius:999px;padding:3px 10px;font-size:12px;background:#3a2c12;color:#ffb54a}
[data-theme=light] .pill{background:#fdf0dc;color:#8a5300}
.ctl{margin-left:auto;display:flex;gap:8px;align-items:center;font-size:13px}
.ctl button{font:inherit;border:1px solid #444;background:transparent;color:inherit;border-radius:8px;padding:6px 10px;cursor:pointer}
.ctl button[aria-pressed=true]{background:#f5f5f7;color:#0b0b0d}
[data-theme=light] .ctl button[aria-pressed=true]{background:#1c1c1e;color:#fff}
main{padding:20px 24px 80px;max-width:1700px}
.summary{max-width:90ch;color:#a7a7ae}[data-theme=light] .summary{color:#5c5c61}
.cmp{margin:28px 0}.note{margin:0 0 10px;color:#a7a7ae;max-width:90ch}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
figure{margin:0;min-width:0}figcaption{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#86868e;margin-bottom:6px}
.spec{border-radius:14px;overflow:hidden;outline:1px solid #2a2a2e}[data-theme=light] .spec{outline-color:#e3e3e8}
.spec iframe{display:block;border:0;transform-origin:0 0}
.none{display:grid;place-items:center;min-height:120px;border:1px dashed #444;border-radius:14px;color:#86868e}
@media (max-width:900px){.pair{grid-template-columns:1fr}}
</style></head><body>
<header class="top"><h1>${esc(e.title)}</h1><span class="pill">Experiment · ${esc(e.module)} · not adopted</span>
<div class="ctl"><button data-t="dark" aria-pressed="true">Dark</button><button data-t="light" aria-pressed="false">Light</button>${e.preview.hitAreas ? '<label><input type="checkbox" id="hit"> Show 44px hit areas</label>' : ""}</div></header>
<main><p class="summary">${esc(e.summary)}${req.length ? ` <strong>After includes required experiment(s): ${esc(req.join(", "))}.</strong>` : ""}</p>${rows || `<section class="cmp"><h2>No visual change</h2><p class="note">This experiment changes the build, not the interface. The README has the measured before/after.</p></section>`}</main>
<script type="text/plain" id="css-fonts">${fontCss(e)}</script>
<script type="text/plain" id="css-before">${before.css}</script>
<script type="text/plain" id="css-after">${after.css}</script>
<script>${before.js}</script>
<script>${after.js}</script>
<script>
(function(){
  var root=document.documentElement, F=document.getElementById('css-fonts').textContent, CSS={before:F+document.getElementById('css-before').textContent,after:F+document.getElementById('css-after').textContent};
  var HIT='.hit-area::before{outline:1px dashed #ff2bd6;background:rgba(255,43,214,.12)}';
  var frames=[];
  function size(f){var d=f.contentDocument,r=d.getElementById('root');if(!r)return;var h=Math.max(r.scrollHeight,r.getBoundingClientRect().height,80);f.style.height=h+'px';var s=Math.min(1,f.parentNode.clientWidth/f._w);f.style.transform=s<1?'scale('+s+')':'none';f.parentNode.style.height=Math.ceil(h*s)+'px'}
  document.querySelectorAll('.spec').forEach(function(el){
    var side=el.dataset.side,w=+el.dataset.w,f=document.createElement('iframe');f._w=w;f.style.width=w+'px';f.title=side+' '+el.dataset.name;el.appendChild(f);frames.push(f);
    var d=f.contentDocument;d.open();d.write('<!doctype html><html data-theme="'+root.dataset.theme+'"><head><meta charset="utf-8"><style>'+CSS[side]+'html,body{margin:0}html{overflow:hidden}</style><style id="hit"></style></head><body><div id="root"></div></body></html>');d.close();
    (side==='before'?window.DSBefore:window.DSAfter).mount(el.dataset.name,d.getElementById('root'));
    setTimeout(function(){size(f)},80);setTimeout(function(){size(f)},500);if(window.ResizeObserver)new ResizeObserver(function(){size(f)}).observe(d.body);
  });
  document.querySelectorAll('.ctl button').forEach(function(b){b.onclick=function(){root.dataset.theme=b.dataset.t;document.querySelectorAll('.ctl button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});frames.forEach(function(f){f.contentDocument.documentElement.dataset.theme=b.dataset.t})}});
  var hit=document.getElementById('hit');if(hit)hit.onchange=function(){frames.forEach(function(f){f.contentDocument.getElementById('hit').textContent=hit.checked?HIT:''})};
  window.addEventListener('resize',function(){frames.forEach(size)});
})();
</script></body></html>`;
}
async function previewOne(id, o) {
  const e = experiment(id);
  const chain = closure(id);
  const req = chain.filter((x) => x !== id);
  const extra = path.join(e.dir, "specimens.tsx");
  const sides = {};
  for (const [side, ids] of [
    ["before", []],
    ["after", chain],
  ]) {
    const tree = materialize(e.base, ids);
    try {
      regenerate(tree);
      // The before bundle only gets the experiment's specimens when they declare that they use
      // nothing new (preview.shared), so a specimen of a new component can't break the baseline build.
      const useExtra = exists(extra) && (side === "after" || e.preview.shared === true);
      if (useExtra) fs.copyFileSync(extra, path.join(tree, "ds-preview-extra.tsx"));
      sides[side] = await bundle(tree, {
        extraSpecimens: useExtra ? side : null,
        globalName: side === "before" ? "DSBefore" : "DSAfter",
      });
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  }
  const out = path.join(e.dir, "preview.html");
  fs.writeFileSync(out, previewHtml(e, sides.before, sides.after, req));
  console.log(`✓ ${rel(out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  if (o.png) {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch(
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    );
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await page.goto("file://" + out);
    await page.waitForTimeout(1200);
    if (e.preview.hitAreas) {
      await page.check("#hit");
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: path.join(e.dir, "before-after.png"), fullPage: true });
    await browser.close();
    console.log(`✓ ${rel(path.join(e.dir, "before-after.png"))}`);
  }
}
async function cmdPreview(o) {
  const id = o._[1];
  if (!id) die("Usage: ds.mjs preview <experiment-id|all> [--png]");
  const ids = id === "all" ? experiments().map((e) => e.id) : [id];
  for (const x of ids) await previewOne(x, o);
}

/* ---------------- compose / publish ---------------- */

function cmdCompose(o) {
  const version = o._[1];
  semver(version ?? "");
  const man = manifest();
  const base = o.base ?? man.active;
  const baseEntry = releaseEntry(man, base);
  if (!baseEntry || baseEntry.status !== "published") die(`Base v${base} is not a published release.`);
  if (cmpVer(version, base) <= 0) die(`v${version} must be greater than the base v${base}.`);
  if (releaseEntry(man, version) || exists(releaseDir(version)))
    die(`v${version} is already published — published releases are immutable.`);
  const ap = approvals();
  const approved = experiments().filter((e) => ap[e.id]?.decision === "approved" && !ap[e.id]?.releasedIn);
  if (!approved.length) die("No approved, unreleased experiments. Approve with: ds.mjs approve <id> --by <name>");

  // 1. dependency gate: every requirement must be approved (or already in the base release)
  const inBase = new Set(baseEntry.experimentsIncluded ?? []);
  const blocked = [];
  for (const e of approved)
    for (const r of e.requires ?? [])
      if (ap[r.id]?.decision !== "approved" && !inBase.has(r.id))
        blocked.push(
          `${e.id} requires ${r.id} (${ap[r.id]?.decision ?? "proposed"}): ${r.why}\n    → approve ${r.id} as well, or set ${e.id} back to proposed.`,
        );
  if (blocked.length)
    die(
      `Cannot compose v${version}. These approvals depend on experiments that are not approved:\n  ${blocked.join("\n  ")}`,
    );

  // 2. order (dependencies first) and apply onto the base
  const order = [];
  const seen = new Set();
  for (const e of approved)
    for (const x of closure(e.id)) if (!seen.has(x) && !inBase.has(x)) (seen.add(x), order.push(x));
  for (const e of experiments())
    if (e.base !== base && order.includes(e.id))
      console.log(`! ${e.id} was written against v${e.base}; applying onto v${base}.`);
  let tree;
  try {
    tree = materialize(base, order);
  } catch (err) {
    const earlier = order.slice(0, order.indexOf(err.experiment));
    const overlap = earlier.filter((x) =>
      patchFiles(path.join(experiment(x).dir, "changes.patch")).some((f) => err.files.includes(f.path)),
    );
    die(
      `${err.message}\n\n${err.experiment} conflicts with ${overlap.join(", ") || "the base"} (same lines in ${err.files.join(", ")}). ` +
        `They cannot be combined until ${err.experiment} is rebased on top of ${overlap.join(", ") || "v" + base} (ds.mjs workspace/save).`,
    );
  }
  regenerate(tree);

  // 3. module map for the new release (new files join their declared module; deleted files leave)
  const map = moduleMap(path.join(releaseDir(base), "modules.json"));
  const kinds = {};
  for (const id of order) {
    const e = experiment(id);
    for (const f of patchFiles(path.join(e.dir, "changes.patch"))) {
      kinds[f.path] = f.kind;
      if (f.kind === "add" && !ownerOf(map, f.path)) {
        const owner = e.newFiles?.[f.path] ?? e.module;
        if (!map.modules[owner]) die(`${id}: unknown module ${owner} for ${f.path}`);
        map.modules[owner].files.push(f.path);
      }
      if (f.kind === "delete")
        for (const m of Object.values(map.modules)) m.files = m.files.filter((x) => x !== f.path);
    }
  }

  // 4. versions: only modules whose files changed are bumped; untouched modules carry over byte-identical
  const moduleVersions = {};
  const changedBy = {};
  for (const [mid, m] of Object.entries(map.modules)) {
    const files = [...m.files, ...(m.generated ?? [])];
    const changed = files.filter((f) => baseEntry.modules[mid]?.files[f] !== sha(path.join(tree, f)));
    const touching = order.filter((id) =>
      patchFiles(path.join(experiment(id).dir, "changes.patch")).some((f) => files.includes(f.path)),
    );
    const kind = touching.some((id) => experiment(id).bump === "major") ? "major" : "minor";
    moduleVersions[mid] = changed.length
      ? bumpVer(baseEntry.modules[mid]?.version ?? base, kind)
      : baseEntry.modules[mid].version;
    changedBy[mid] = { changed, touching };
  }
  const breaking = order.some((id) => experiment(id).bump === "major");
  const [bM] = semver(base);
  const [vM] = semver(version);
  if (breaking && vM === bM)
    die(`An included experiment is breaking (bump: major). Use v${bumpVer(base, "major")} or higher.`);

  // 5. validation in the composed tree
  let validation =
    "Not run. Re-run compose with --check (lint, typecheck, unit tests) or --full (plus integration tests and build).";
  if (o.check || o.full) {
    const steps = [
      ["lint", "npm", ["run", "--silent", "lint"]],
      ["typecheck", "npm", ["run", "--silent", "typecheck"]],
      ["unit tests", "npx", ["vitest", "run", "--project", "unit"]],
    ];
    if (o.full)
      steps.push(
        ["integration tests", "npx", ["vitest", "run", "--project", "integration"]],
        ["build", "npm", ["run", "--silent", "build"]],
      );
    const res = [];
    for (const [name, cmd, a] of steps) {
      if (name === "build") widenTurbopackRoot(tree);
      const r = run(cmd, a, { cwd: tree, env: { ...process.env, CI: "1" } });
      res.push(`- ${r.code === 0 ? "✓" : "✗"} ${name}`);
      console.log(`${r.code === 0 ? "✓" : "✗"} ${name}`);
      if (r.code !== 0) {
        console.log(r.out.trim().split("\n").slice(-40).join("\n"));
        die(`Validation failed (${name}). The candidate was not written.`);
      }
    }
    validation = `Run ${today()} in a composed copy of the repo:\n\n${res.join("\n")}`;
  }

  // 6. write the candidate
  const dir = candidateDir(version);
  fs.rmSync(dir, { recursive: true, force: true });
  const included = order.map((id) => ({
    id,
    ...ap[id],
    requiredBy: approved.some((a) => a.id === id)
      ? undefined
      : approved.filter((a) => closure(a.id).includes(id)).map((a) => a.id),
  }));
  const notes = releaseNotes({
    version,
    base,
    baseEntry,
    map,
    order,
    included,
    moduleVersions,
    changedBy,
    validation,
    breaking,
  });
  const entry = writeRelease(
    dir,
    version,
    map,
    (f) => path.join(tree, f),
    {
      status: "candidate",
      date: today(),
      base,
      summary: `Base v${base} + ${order.join(", ")}`,
      experiments: order,
      experimentsIncluded: [...inBase, ...order],
      moduleVersions,
    },
    notes,
  );
  writeJson(path.join(dir, "candidate.json"), entry);
  fs.rmSync(tree, { recursive: true, force: true });
  console.log(
    `\n✓ Candidate v${version} written to ${rel(dir)} — not published, not adopted.\n  Review ${rel(path.join(dir, "RELEASE.md"))}, then: ds.mjs publish ${version}`,
  );
}
function releaseNotes({
  version,
  base,
  baseEntry,
  map,
  order,
  included,
  moduleVersions,
  changedBy,
  validation,
  breaking,
}) {
  const cross = [];
  for (const id of order) {
    const e = experiment(id);
    for (const f of patchFiles(path.join(e.dir, "changes.patch"))) {
      const owner = ownerOf(map, f.path);
      if (owner && owner !== e.module)
        cross.push(
          `- \`${f.path}\` belongs to ${map.modules[owner].title}; changed by ${id} (${map.modules[e.module].title})${map.modules[owner].sharedSections?.[f.path] ? ` — ${map.modules[owner].sharedSections[f.path]}` : ""}`,
        );
    }
  }
  const modRows = Object.entries(map.modules)
    .map(([id, m]) => {
      const c = changedBy[id];
      return `| ${m.title} | ${baseEntry.modules[id]?.version ?? "—"} | ${moduleVersions[id]} | ${c.changed.length ? c.changed.map((f) => "`" + f + "`").join("<br>") : "unchanged — carried over byte-identical"} | ${c.touching.join(", ") || "—"} |`;
    })
    .join("\n");
  const exps = included
    .map((x) => {
      const e = experiment(x.id);
      return `### ${e.id} — ${e.title}\n\nModule: ${e.module} · bump: ${e.bump}${x.requiredBy ? ` · included because ${x.requiredBy.join(", ")} requires it` : ""} · approved by ${x.by ?? "—"} on ${x.date ?? "—"}\n\n${e.summary}\n\n**Migration:** ${e.migration}`;
    })
    .join("\n\n");
  return `# v${version} — release candidate

Composed ${today()} from **v${base}** plus the approved experiments below. Every module that no experiment touched is carried over from v${base} byte-identical (verified by hash). ${breaking ? "**Contains breaking changes.**" : "No breaking changes."}

## Modules

| Module | v${base} | v${version} | Changed files | Experiments |
| --- | --- | --- | --- | --- |
${modRows}

Generated files (\`src/app/tokens.css\`, \`design-system/tokens.json\`) were rebuilt with \`npm run tokens\` from the composed \`tokens.ts\`.
${cross.length ? `\n**Cross-module changes** (need review by both module owners):\n\n${cross.join("\n")}\n` : ""}

## Included experiments

${exps}

## Migration notes

${included.map((x) => `- **${x.id}:** ${experiment(x.id).migration}`).join("\n")}

After adoption: run \`npm run check\`, then \`npm run build && npm run test:e2e\`; update the design-system docs (README, component pages) for the changed modules and rebuild the previews (\`node design-system/viewer/build.mjs\` and \`build-html.mjs\`).

## Validation

${validation}

## Adopt (only with explicit authorization)

\`\`\`sh
node design-system/versioning/ds.mjs publish ${version}
node design-system/versioning/ds.mjs adopt ${version} --authorized-by "<name>"
\`\`\`

## Rollback

\`\`\`sh
node design-system/versioning/ds.mjs rollback ${base} --authorized-by "<name>"
\`\`\`

Rollback copies \`releases/v${base}/files/\` back over the module files and restores \`versioning/modules.json\`; files that v${version} added are removed. Manual alternative: copy every file in \`design-system/releases/v${base}/files/\` to the same path in the repo, delete the files listed as added above, then run \`npm run check\`.
`;
}
function cmdPublish(o) {
  const version = o._[1];
  semver(version ?? "");
  const man = manifest();
  if (releaseEntry(man, version)) die(`v${version} is already published.`);
  const cdir = candidateDir(version);
  if (!exists(cdir)) die(`No candidate v${version}. Run compose first.`);
  const entry = readJson(path.join(cdir, "candidate.json"));
  fs.rmSync(path.join(cdir, "candidate.json"));
  if (checksums(cdir) !== fs.readFileSync(path.join(cdir, "checksums.sha256"), "utf8"))
    die("The candidate was edited after compose. Re-run compose.");
  fs.renameSync(cdir, releaseDir(version));
  entry.status = "published";
  entry.publishedAt = now();
  entry.notes = rel(path.join(releaseDir(version), "RELEASE.md"));
  entry.checksum = sha(path.join(releaseDir(version), "checksums.sha256"));
  man.releases.push(entry);
  man.history.push({ action: "publish", version, at: now(), by: o.by ?? "" });
  writeJson(MANIFEST, man);
  const ap = approvals();
  for (const id of entry.experiments) if (ap[id]) ap[id].releasedIn = version;
  writeJson(APPROVALS, ap);
  console.log(
    `✓ Published v${version} (immutable). Active is still v${man.active} — adopting needs explicit authorization.`,
  );
}

/* ---------------- adopt / rollback ---------------- */

function cmdAdopt(o, action) {
  const version = o._[1];
  semver(version ?? "");
  const who = o["authorized-by"];
  if (typeof who !== "string" || !who.trim())
    die(
      `${action} changes the developer's active design system. It needs explicit authorization: --authorized-by "<name>".`,
    );
  const man = manifest();
  const target = releaseEntry(man, version);
  if (!target || target.status !== "published") die(`v${version} is not a published release.`);
  if (man.active === version) die(`v${version} is already active.`);
  if (action === "rollback" && cmpVer(version, man.active) >= 0)
    die(`Rollback goes to an earlier release; v${version} is not older than v${man.active}. Use adopt.`);
  const problems = verifyRelease(target);
  if (problems.length) die(`v${version} failed integrity checks:\n  ${problems.join("\n  ")}`);
  const d = activeDrift(man);
  if (d.changed.length || d.missing.length || d.extra.length)
    die(
      `The active files have unreleased changes since v${man.active}:\n  ${[...d.changed, ...d.missing, ...d.extra].join("\n  ")}\n` +
        `Nothing was changed. Record them first (ds.mjs release ${bumpVer(man.active, "patch")} --from-active) or resolve them, then ${action} again.`,
    );
  const fromMap = moduleMap(path.join(releaseDir(man.active), "modules.json"));
  const toMap = moduleMap(path.join(releaseDir(version), "modules.json"));
  const toFiles = new Set(filesOf(toMap).map((f) => f.path));
  const removed = filesOf(fromMap).filter((f) => !toFiles.has(f.path));
  for (const f of filesOf(toMap)) copy(path.join(releaseDir(version), "files", f.path), path.join(REPO, f.path));
  for (const f of removed) fs.rmSync(path.join(REPO, f.path), { force: true });
  fs.copyFileSync(path.join(releaseDir(version), "modules.json"), MODULES);
  man.history.push({
    action,
    version,
    from: man.active,
    at: now(),
    by: who,
    reason: o.reason === true ? "" : (o.reason ?? ""),
  });
  const from = man.active;
  man.active = version;
  writeJson(MANIFEST, man);
  console.log(
    `✓ ${action === "rollback" ? "Rolled back" : "Adopted"} v${from} → v${version} (authorized by ${who}). ${toFiles.size} files written${removed.length ? `, ${removed.length} removed (${removed.map((f) => f.path).join(", ")})` : ""}.\n` +
      `  Next: npm run check, then npm run build && npm run test:e2e. Undo: ds.mjs ${cmpVer(from, version) < 0 ? "rollback" : "adopt"} ${from} --authorized-by "<name>"`,
  );
}

/* ---------------- authoring ---------------- */

function cmdWorkspace(o) {
  const id = o._[1];
  const e = experiment(id);
  const dir = path.resolve(o.dir ?? path.join(os.tmpdir(), "creatorco-ds", id));
  fs.rmSync(dir, { recursive: true, force: true });
  materialize(e.base, closure(id), dir);
  regenerate(dir);
  console.log(
    `✓ Workspace for ${id} at ${dir}\n  Edit files there (base v${e.base}${(e.requires ?? []).length ? " + " + e.requires.map((r) => r.id).join(", ") : ""}), then: ds.mjs save ${id} --dir ${dir}`,
  );
}
function cmdSave(o) {
  const id = o._[1];
  const e = experiment(id);
  if (typeof o.dir !== "string") die("Usage: ds.mjs save <id> --dir <workspace>");
  const ws = path.resolve(o.dir);
  const baseTree = materialize(
    e.base,
    closure(id).filter((x) => x !== id),
  );
  const map = moduleMap(path.join(releaseDir(e.base), "modules.json"));
  const generated = new Set(
    filesOf(map)
      .filter((f) => f.generated)
      .map((f) => f.path),
  );
  let patch = "";
  for (const top of ["src", "tests"]) {
    const r = run("git", [
      "diff",
      "--no-index",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      path.join(baseTree, top),
      path.join(ws, top),
    ]);
    if (r.code > 1) die(r.out);
    // git prints absolute paths without their leading slash after the a/ b/ prefixes
    patch += r.out
      .split(baseTree.replace(/^\//, "") + "/")
      .join("")
      .split(ws.replace(/^\//, "") + "/")
      .join("");
  }
  const blocks = patch
    .split(/(?=^diff --git )/m)
    .filter((b) => b.trim() && ![...generated].some((g) => b.startsWith(`diff --git a/${g} `)));
  fs.writeFileSync(path.join(e.dir, "changes.patch"), blocks.join(""));
  fs.rmSync(baseTree, { recursive: true, force: true });
  const files = patchFiles(path.join(e.dir, "changes.patch"));
  console.log(
    `✓ ${rel(path.join(e.dir, "changes.patch"))}: ${files.map((f) => `${f.kind} ${f.path}`).join(", ") || "no changes"}`,
  );
}

/* ---------------- main ---------------- */

const o = args(process.argv.slice(2));
const cmd = o._[0];
const table = {
  status: cmdStatus,
  verify: cmdVerify,
  release: cmdRelease,
  approve: (x) => cmdDecide("approve", x),
  reject: (x) => cmdDecide("reject", x),
  reset: (x) => cmdDecide("reset", x),
  preview: cmdPreview,
  compose: cmdCompose,
  publish: cmdPublish,
  adopt: (x) => cmdAdopt(x, "adopt"),
  rollback: (x) => cmdAdopt(x, "rollback"),
  workspace: cmdWorkspace,
  save: cmdSave,
};
if (!table[cmd]) {
  console.log(
    fs
      .readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("*/")[0]
      .replace(/^#!.*\n\/\*\*?/, "")
      .replace(/^ \* ?/gm, ""),
  );
  process.exit(cmd ? 1 : 0);
}
await table[cmd](o);
