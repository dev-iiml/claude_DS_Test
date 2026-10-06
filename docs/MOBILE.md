# Native apps plan (iOS first, Android next)

CLAUDE.md keeps Phase 1 web-only, so no native app is built yet. The codebase is shaped so one can be added without
re-deciding product logic.

## What a native app reuses

| Layer          | Source of truth                                                                       | Native use                                                    |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Design tokens  | `src/design/tokens.ts` (colours, type, radius, motion, touch target)                  | Import directly (Expo/React Native) or export to Swift/Kotlin |
| Domain rules   | `modules/*/rules.ts`, `schemas.ts`, `presentation.ts`, `professional-graph/engine.ts` | Pure TS — no Node/DOM/Next imports                            |
| Data & actions | `/api/v1` (see `docs/API.md`)                                                         | All reads/writes; never direct DB access                      |
| Copy           | `FEATURE_COPY`, consent texts from `/consents/{key}`                                  | Identical wording across platforms                            |

## Recommended path

- **Expo (React Native) + TypeScript** in a future `apps/mobile` workspace, sharing the pure modules above. This gives
  iOS first and Android from the same code. SwiftUI remains an option for a later premium iOS rewrite — tokens and the
  API make that a UI-only effort.
- Store the bearer token in the Keychain / Android Keystore (`expo-secure-store`). Sign in with `client: "ios"` or
  `"android"`.
- Social connection via `ASWebAuthenticationSession` / Custom Tabs, then `POST /social/connections/complete`.

## UI mapping (already used on the web)

| Web component                   | iOS (SwiftUI)                            | Android (Compose)           |
| ------------------------------- | ---------------------------------------- | --------------------------- |
| `TabBar` / `Sidebar`            | `TabView` / `NavigationSplitView`        | `NavigationBar` / rail      |
| `PageHeader` (34pt)             | `.navigationTitle` large                 | `LargeTopAppBar`            |
| `ListGroup` / `ListRow`         | `List` + `Section` (inset grouped)       | `ListItem` in cards         |
| `SwitchRow`, `SegmentedControl` | `Toggle`, `Picker(.segmented)`           | `Switch`, `SegmentedButton` |
| `FormFooter` (sticky CTA)       | `.safeAreaInset(edge: .bottom)`          | bottom bar                  |
| `MembershipCard`                | custom view (no financial figures, ever) | same                        |

Appearance: dark is the signature default; Light and System are user choices (`cc_appearance` on web, app setting on
native).

## Before building native

- Register universal/app links and add their redirect URIs to the provider allowlist.
- Expose OTP / identity prefill / GST lookup as API routes (currently web server actions).
- Add per-device session listing and revocation, and push via `NotificationProvider`.
