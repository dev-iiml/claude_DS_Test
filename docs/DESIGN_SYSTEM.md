# Design system — pinned release (app side)

**Active release: v2.0.0** (pinned 3 Oct 2026, authorized by Aman). Record: [`design-system.lock.json`](../design-system.lock.json).

The app runs exactly one published design-system release. It never adopts "latest", a candidate, a draft, a proposal
or an experiment on its own. The design-system workspace (`design-system/`, maintained with the design-system agent)
has its own release process — see `design-system/versioning/README.md`. This page covers the app's side: the pin, the
guards and the upgrade runbook.

## The pin

`design-system.lock.json` is app-owned and lives outside `design-system/`. It records the release version, the
release checksum, its module versions, the SHA-256 of every file the release owns (37 files across 7 modules in
v2.0.0, including the generated `src/app/tokens.css`), the watched folders, who authorized it, the previous release
(the rollback path) and the full history. Because the lock carries the hashes itself, the pin holds even if the
workspace's own `manifest.json` → `active` pointer, its candidates or its experiments change.

## Guards — how experimental work is kept out of the running app

| Path a change could take                                  | Guard                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Shared files** — editing a release-owned file in `src/` | `npm run ds:check` fails on any byte difference, deleted file, or new file in `src/design`, `src/components/ui`, `src/components/creatorco` that the release doesn't contain               |
| **Imports** — app code importing from `design-system/`    | `ds:check` fails on any `import` / `require` / `@import` / `@source` / `@plugin` that points into `design-system/`; `tsconfig` and ESLint exclude the folder                               |
| **Generated assets** — Tailwind picking up classes        | `postcss.config.mjs` limits Tailwind's source scan to `src/` (before this, 169 unused classes from `design-system/` files reached the app's CSS); `ds:check` fails if the limit is removed |
| **Generated assets** — tokens                             | `tokens.css` is pinned by hash; it is regenerated only from the pinned `tokens.ts` (`npm run tokens`)                                                                                      |
| **The workspace's "active" pointer moving**               | Ignored, with a warning: the app stays on the lock's release until an authorized `npm run ds:pin`                                                                                          |
| **A published release being edited afterwards**           | `ds:check` (when the workspace is present) and `ds:pin` compare the release checksum with the pin and refuse a tampered release                                                            |

`ds:check` runs before `npm run dev`, before `npm run build` (so a deploy can't ship drift) and first in
`npm run check`; the unit suite repeats it. Modes, by environment variable `DS_PIN_MODE`:

- unset — enforce (the default everywhere, including builds);
- `candidate` — for the design-system agent's **disposable copies** that validate a candidate release: differences
  are reported, never blocking;
- `warn` — local, throwaway experiments only; never for builds or commits.

Building features continues against v2.0.0: app-specific UI goes in route folders (`src/app/**/`) built from the
pinned components. A new or changed design-system component is a design-system change: it goes through an experiment
and a release, not a direct edit.

## Upgrading — only when Aman authorizes it

1. **Review the target release** (in `design-system/releases/v<version>/`):
   - `RELEASE.md` — which modules changed and which were carried over byte-identical, the experiments included (with
     approver and date), cross-module changes, migration notes, validation, rollback;
   - the manifest entry (`design-system/releases/manifest.json`) — status must be `published`, module versions, file
     hashes;
   - `modules.json` — module ownership, new files and their owners;
   - dependencies — every included experiment's requirements are included too (`ds.mjs status`).
   - Run `node design-system/versioning/ds.mjs verify --strict`.
2. **Apply:** `node design-system/versioning/ds.mjs adopt <version> --authorized-by "Aman" --reason "…"`, then
   `npm run tokens` if the tokens module changed (the result must equal the release's generated files).
3. **Pin:** `npm run ds:pin -- <version> --authorized-by "Aman" --reason "…"`. It refuses unless the version is
   exact and published, its checksums are intact and the working tree already matches every file.
4. **Verify:**
   - `npm run check` (pin check, lint, typecheck, format, unit + integration tests);
   - `npm run build && npm run test:e2e`, which includes `e2e/design-system.spec.ts`: landing, login, dashboard,
     Passport, eligibility and the risk console in **dark and light**, on **desktop and mobile**. It asserts the theme
     tokens apply and nothing scrolls horizontally, and saves screenshots to `.ds-screens/v<version>/`. Run
     `npm run ds:screens` on the old release first to get the "before" set.
   - Apply the release's migration notes to any app screen that uses a changed component, and look at the affected
     screens.
5. **Record:** the lock's history holds the upgrade (version, who, when, why). Update the "Active release" line above,
   the README and the stage build log.

## Rolling back

```sh
node design-system/versioning/ds.mjs rollback <previous> --authorized-by "Aman" --reason "…"
npm run ds:pin -- <previous> --authorized-by "Aman" --reason "rollback: …"
npm run check && npm run build && npm run test:e2e
```

The previous release is in the lock's `previous` field. If the tool can't run: copy every file under
`design-system/releases/v<previous>/files/` to the same path, delete files the newer release added (listed in its
`RELEASE.md`), then `npm run ds:pin` and the checks.

## Selected modules only

If only some modules or experiments are wanted, the design-system agent first composes and publishes a **compatible
release** containing just those (approved experiments plus every other module carried over byte-identical, with
requirements resolved — e.g. touch-target experiments need `tokens.hit-area`). The app then upgrades to that release
through the steps above. The app never picks individual files out of experiments or candidates.

## Notes

- Full-page screenshots show fixed bars (mobile tab bar) where they sit in the viewport, partway down the image.
- Automated checks don't replace a manual accessibility review (screen readers, keyboard, Dynamic Type, zoom).
