import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Route-guard inventory (Stage 16). Every page, route handler and server action
 * under `src/app` must authorise before doing anything — directly, or through a
 * local helper / a known guarded helper — unless it is on the explicit public
 * list below with a reason. A new public entry point is a reviewed decision.
 *
 * Static and conservative: it checks each exported handler's own body (plus the
 * bodies of same-file functions it calls) for a guard CALL in the AST (comments
 * and strings don't count). It can't prove the guard runs first or on every
 * branch, and layouts / generateMetadata aren't inventoried (they render no
 * data without their page's guard) — review covers those.
 */

const ROOT = join(process.cwd(), "src/app");

/** Calls that authorise (each verified by its own tests) or helpers that call one first. */
const GUARD_NAME =
  /^(require(Creator|Member|Admin|OpsAdmin|PartnershipsAdmin|InsightsViewer|ConsentCentreAccess|Partner|ApiUser|ApiCreator|ApiMember|User)|load(Application|Onboarding)Step|resumePath|handle(About|Profile|Business|Interests|Consent))$/;
/** Text form, for the helper files. */
const GUARD = new RegExp(`\\b${GUARD_NAME.source.slice(1, -1)}\\s*\\(`);

/** Public entry points: file (relative to src/app) → exported names → reason. */
const PUBLIC: Record<string, Record<string, string>> = {
  "page.tsx": { default: "landing page (reads the session only to pick a CTA)" },
  "(auth)/login/page.tsx": { default: "sign-in form" },
  "(auth)/signup/page.tsx": { default: "sign-up form" },
  "(auth)/actions.ts": {
    signUpAction: "creates the account (rate limited)",
    signInAction: "signs in (rate limited, per-account lockout)",
    signOutAction: "ends the caller's own session",
  },
  "api/v1/health/route.ts": { GET: "liveness, no data" },
  "api/v1/auth/sign-in/route.ts": { POST: "native sign-in (rate limited, per-account lockout)" },
  "api/v1/auth/sign-up/route.ts": { POST: "native sign-up (rate limited)" },
  "_actions/appearance.ts": { setAppearanceAction: "stores the caller's light/dark preference cookie only" },
  "api/internal/cron/tick/route.ts": { GET: "CRON_SECRET bearer, constant-time compare; 404 when unset" },
};

const HANDLER_NAMES = new Set(["default", "GET", "POST", "PUT", "PATCH", "DELETE"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    if (/^(page\.tsx|route\.ts)$/.test(name)) return [path];
    // Server actions: any module that starts with the "use server" directive.
    return /\.tsx?$/.test(name) && /^\s*["']use server["']/.test(readFileSync(path, "utf8")) ? [path] : [];
  });
}

interface Handler {
  name: string;
  /** Names of functions actually called (from the AST — comments and strings don't count). */
  calls: Set<string>;
}

function callNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee)) names.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) names.add(callee.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** Exported handlers with the calls in their body and in same-file functions they call. */
function handlersOf(file: string): Handler[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const isServerActions = /^\s*["']use server["']/.test(source.text);
  const locals = new Map<string, Set<string>>();
  const exported: Handler[] = [];

  const exportedName = (node: ts.Node, name: string) => {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExport = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    return isExport ? (isDefault ? "default" : name) : null;
  };

  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.body) {
      const name = stmt.name?.text ?? "default";
      const calls = callNames(stmt.body);
      locals.set(name, calls);
      const ex = exportedName(stmt, name);
      if (ex && (isServerActions || HANDLER_NAMES.has(ex))) exported.push({ name: ex, calls });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const calls = callNames(decl.initializer);
        locals.set(decl.name.text, calls);
        const ex = exportedName(stmt, decl.name.text);
        const isFunction = /=>|function/.test(decl.initializer.getText(source));
        if (ex && (isServerActions || HANDLER_NAMES.has(ex)) && isFunction) exported.push({ name: ex, calls });
      }
    }
  }

  // One level of same-file delegation (e.g. a route's shared `handle()`).
  return exported.map((h) => {
    const calls = new Set(h.calls);
    for (const n of h.calls) if (n !== h.name) for (const c of locals.get(n) ?? []) calls.add(c);
    return { name: h.name, calls };
  });
}

const guarded = (h: Handler) => [...h.calls].some((c) => GUARD_NAME.test(c));

const files = walk(ROOT).sort();

describe("route-guard inventory", () => {
  it("finds the app's entry points", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it.each(files.map((f) => [relative(ROOT, f), f] as const))("%s authorises every handler", (rel, file) => {
    const handlers = handlersOf(file);
    expect(handlers.length, `${rel}: no exported handler found`).toBeGreaterThan(0);
    const unguarded = handlers.filter((h) => !guarded(h) && !PUBLIC[rel]?.[h.name]).map((h) => h.name);
    expect(unguarded, `${rel}: add a guard, or list it in PUBLIC with a reason`).toEqual([]);
  });

  it("every public entry still exists (no stale allow-list)", () => {
    for (const [rel, names] of Object.entries(PUBLIC)) {
      const handlers = handlersOf(join(ROOT, rel)).map((h) => h.name);
      for (const name of Object.keys(names)) expect(handlers, `${rel} ${name}`).toContain(name);
    }
  });

  it("guarded helpers authorise in every exported function", () => {
    for (const helper of [
      "onboarding/_lib/step-handlers.ts",
      "eligibility/_lib/load.ts",
      "onboarding/_lib/context.ts",
    ]) {
      const source = readFileSync(join(ROOT, helper), "utf8");
      const fns = [...source.matchAll(/export async function (\w+)[\s\S]*?\n}/g)];
      expect(fns.length, helper).toBeGreaterThan(0);
      for (const fn of fns) expect(fn[0], `${helper} ${fn[1]}`).toMatch(GUARD);
    }
  });
});
