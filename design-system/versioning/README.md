# Design-system versioning

How the CreatorCo design system is released, changed and rolled back without disturbing the app.

```
                 approve / reject                  compose (approved only)        publish              adopt / rollback
experiments/ ─────────────────────▶ approvals.json ────────────────────────▶ releases/candidates/ ───────▶ releases/vX.Y.Z ─────────────────▶ src/
 (isolated)                                          + unchanged baseline modules   (mutable)         (immutable)     (only with --authorized-by)
```

## Principles

1. **The active release is what `src/` contains.** `releases/manifest.json` → `active` names it (today **v2.0.0**). Only `adopt` and `rollback` write to `src/`, and both refuse to run without `--authorized-by "<name>"`.
2. **Published releases are immutable.** Every published release keeps a full copy of its module files (`files/`), its module map (`modules.json`), notes (`RELEASE.md`) and `checksums.sha256`. The manifest records each file's SHA-256 and the checksum file's own hash. `verify` fails if anything changes, and `compose`, `publish` and `release` refuse to overwrite an existing version.
3. **Experiments are isolated.** They live in `experiments/` as patches against a base release. Nothing under `design-system/` is imported by the app, linted, type-checked or bundled into it. Previews and checks run in disposable copies of the repo outside the project. Until `tokens.source-isolation` is adopted, Tailwind's automatic source scan still picks up class names from `design-system/` files. Those classes are unused and change nothing visible, but adopting that experiment closes the gap.
4. **Selective approval.** A new release is the base release, plus the approved experiments (and only those), with every other module carried over byte-identical. Module versions move only when their files change.
5. **The developer's work is preserved.** If `src/` has changes that no release records ("drift"), `adopt` and `rollback` stop without touching anything. `verify` lists the drift, and `release <patch> --from-active` records it as a new release first.

## Modules

Defined in `modules.json`. Every design-system source file belongs to exactly one module:

| Module             | Owns                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens and themes  | `tokens.ts` (colour/shape/depth/size/motion sections), renderers and scripts, generated `tokens.css` and `tokens.json`, `globals.css`, `cn.ts`, Card, Separator, Skeleton, the `creatorco` barrel, token tests |
| Typography         | the `fonts`/`type` sections of `tokens.ts`, heading roles, Label, Wordmark                                                                                                                                     |
| Buttons            | Button, SubmitButton                                                                                                                                                                                           |
| Forms              | Input, NativeSelect, Alert, FormField, FormMessage, choice controls, RequirementChecklist, progress                                                                                                            |
| Navigation         | TabBar/Sidebar, shells (incl. ComplianceNote), ListGroup, EmptyState                                                                                                                                           |
| Membership         | MembershipCard, status badges, VerificationMark, Badge                                                                                                                                                         |
| Financial patterns | ConsentText, MetricBlock (+ new money components)                                                                                                                                                              |

A new file added by an experiment joins the module named in its `experiment.json` → `newFiles`.

## Commands

Run from the repo root with Node (no extra dependencies):

| Command                                                        | What it does                                                                                                                                                                                                                                                                                                                      | Writes to `src/`? |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `node design-system/versioning/ds.mjs status`                  | Active release, releases, experiments and decisions                                                                                                                                                                                                                                                                               | no                |
| `… verify [--strict]`                                          | Checksums of every published release; manifest consistency; drift of `src/` against the active release; every experiment still applies                                                                                                                                                                                            | no                |
| `… approve <id> --by "<name>" [--note …]` / `reject` / `reset` | Records a decision in `experiments/approvals.json`                                                                                                                                                                                                                                                                                | no                |
| `… preview <id\|all> [--png]`                                  | Rebuilds `preview.html` (and `before-after.png`) from the real components, before vs after                                                                                                                                                                                                                                        | no                |
| `… compose <version> [--check] [--full]`                       | Builds a candidate from the active release + approved experiments, rebuilds the generated token files, writes `releases/candidates/v<version>/` with notes, migration and rollback. `--check`: lint, typecheck, unit tests in a disposable copy. `--full`: also integration tests (separate test database) and a production build | no                |
| `… publish <version>`                                          | Freezes a candidate as `releases/v<version>/` and adds it to the manifest                                                                                                                                                                                                                                                         | no                |
| `… adopt <version> --authorized-by "<name>" [--reason …]`      | Copies the release into `src/`, removes files the release dropped, records who authorized it                                                                                                                                                                                                                                      | **yes**           |
| `… rollback <version> --authorized-by "<name>"`                | Same, to an earlier published release                                                                                                                                                                                                                                                                                             | **yes**           |
| `… release <version> --from-active`                            | Records the current `src/` files as a published release (how v2.0.0 was formalized; also how developer drift is captured)                                                                                                                                                                                                         | no                |
| `… workspace <id>` / `save <id> --dir …`                       | Authoring: materialize base + requirements outside the repo, edit, save the diff as `changes.patch`                                                                                                                                                                                                                               | no                |

## Typical flow

1. Review an experiment: read its `README.md`, open `preview.html`, read `changes.patch`.
2. Decide: `ds.mjs approve tokens.hit-area --by "Aman"`. If an approval needs another experiment, the command says so straight away.
3. Compose: `ds.mjs compose 2.1.0 --full`. It refuses if a requirement isn't approved, if patches conflict, or if any check fails, and explains why. Breaking experiments (`bump: major`) need a major version.
4. Read `releases/candidates/v2.1.0/RELEASE.md`: module table (changed vs carried over), included experiments with approver and date, cross-module changes, migration notes, validation, rollback.
5. Publish: `ds.mjs publish 2.1.0`. From now on v2.1.0 can't be changed.
6. **Only when authorized:** `ds.mjs adopt 2.1.0 --authorized-by "<name>"`, then `npm run check`, then `npm run build && npm run test:e2e`. Update the docs and previews for the changed modules in the same PR.

## Rollback

```sh
node design-system/versioning/ds.mjs rollback 2.0.0 --authorized-by "<name>" --reason "…"
```

Restores every module file of the target release byte-for-byte, removes files the newer release added, restores `modules.json`, and records the rollback in the manifest history. Manual fallback, if the tool can't run: copy every file under `design-system/releases/v2.0.0/files/` to the same path in the repo, delete the files the newer release's notes list as added, then run `npm run check`.

## When the developer changes design-system files directly

That is allowed: the active app keeps working, and nothing is blocked. `verify` reports the files as unreleased changes. Record them as a patch release before the next adoption:

```sh
node design-system/versioning/ds.mjs release 2.0.1 --from-active --summary "…" --by "<name>"
```

New component files need an owner in `modules.json` first. `release` lists any that don't have one. Experiments based on v2.0.0 usually still apply to v2.0.1, and `verify` shows any that don't.

## Files

| Path                      | What                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `versioning/ds.mjs`       | The tool                                                                                                                  |
| `versioning/modules.json` | Module ownership for the active release                                                                                   |
| `releases/manifest.json`  | Releases, their module versions and file hashes, the active pointer and the history (formalize, publish, adopt, rollback) |
| `releases/v*/`            | Immutable published releases                                                                                              |
| `releases/candidates/`    | Composed, not yet published                                                                                               |
| `experiments/`            | Proposed changes, one folder per experiment; `approvals.json`                                                             |
| `../RELEASES.md`          | Human-readable release index                                                                                              |
