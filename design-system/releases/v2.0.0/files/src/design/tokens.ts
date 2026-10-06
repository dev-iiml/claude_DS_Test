/**
 * CreatorCo design tokens — the single source of truth for every platform.
 *
 * - Web: `npm run tokens` generates `src/app/tokens.css` (CSS variables).
 * - Native (future Expo / SwiftUI / Compose apps): import this file or the
 *   JSON it serialises to; names and values are platform-neutral.
 *
 * Direction: dark-first, exclusive, iOS/macOS-native. Near-black surfaces,
 * platinum for interactive UI, champagne gold reserved for status and
 * membership moments. Every text pair meets WCAG AA (checked in tests).
 */

export const THEMES = ["dark", "light"] as const;
export type ThemeName = (typeof THEMES)[number];

export const APPEARANCES = ["dark", "light", "system"] as const;
export type Appearance = (typeof APPEARANCES)[number];
export const DEFAULT_APPEARANCE: Appearance = "dark";

export interface ColorTokens {
  /** App background (iOS systemBackground / grouped background). */
  paper: string;
  /** Cards, grouped list cells. */
  surface: string;
  /** Sheets, popovers, inputs. */
  elevated: string;
  /** Primary label. */
  ink: string;
  /** Secondary label. */
  inkMuted: string;
  /** Tertiary label (still AA on paper and surface). */
  inkSubtle: string;
  /** Hairline separators. */
  line: string;
  /** Stronger borders (selected rows, outlines). */
  lineStrong: string;
  /**
   * Control boundary: text-field borders, switch off-track, unmet checklist
   * rings, upcoming progress steps. ≥ 3:1 against paper, surface and elevated.
   * (`lineStrong` is decorative only — never a control boundary or state.)
   */
  inputBorder: string;
  /** Primary interactive fill (buttons) and its label. */
  primary: string;
  primaryForeground: string;
  /** Champagne gold — status, membership, focus. */
  gold: string;
  goldSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  /** Translucent bar background (tab bar, nav bar) used with backdrop blur. */
  bar: string;
  /** Switch thumb (white in both themes, like iOS). */
  thumb: string;
}

export const colors: Record<ThemeName, ColorTokens> = {
  dark: {
    paper: "#050506",
    surface: "#121214",
    elevated: "#1c1c1f",
    ink: "#f5f5f7",
    inkMuted: "#a7a7ae",
    inkSubtle: "#86868e",
    line: "#232327",
    lineStrong: "#3a3a40",
    inputBorder: "#74747d",
    primary: "#e9e9ee",
    primaryForeground: "#0a0a0b",
    gold: "#d8bf92",
    goldSoft: "#2a241a",
    success: "#4cd964",
    successSoft: "#102a17",
    warning: "#ffb54a",
    warningSoft: "#2e2312",
    danger: "#ff7a70",
    dangerSoft: "#341716",
    info: "#70d4ff",
    infoSoft: "#0e2530",
    bar: "rgba(18, 18, 20, 0.78)",
    thumb: "#ffffff",
  },
  light: {
    paper: "#f2f2f7",
    surface: "#ffffff",
    elevated: "#ffffff",
    ink: "#1c1c1e",
    inkMuted: "#5c5c61",
    inkSubtle: "#6c6c71",
    line: "#e3e3e8",
    lineStrong: "#c7c7cc",
    inputBorder: "#86868b",
    primary: "#1c1c1e",
    primaryForeground: "#ffffff",
    gold: "#7f6230",
    goldSoft: "#f3ecdf",
    success: "#1d7a37",
    successSoft: "#e5f4e8",
    warning: "#8a5300",
    warningSoft: "#fbf0dc",
    danger: "#c4281c",
    dangerSoft: "#fbe6e4",
    info: "#0a6588",
    infoSoft: "#e2f2f8",
    bar: "rgba(249, 249, 251, 0.82)",
    thumb: "#ffffff",
  },
};

/**
 * Membership-card material. Theme-independent: the card is a dark object in
 * both appearances. The only surface allowed gradients, sheen and depth.
 */
export const membership = {
  base: "#0d0d0f",
  ink: "#f5f5f7",
  accent: "#d8bf92",
  /** Single soft highlight in the top-right corner. */
  sheen: "rgba(216, 191, 146, 0.22)",
  /** Inner hairline ring. */
  edge: "rgba(255, 255, 255, 0.1)",
  /** Top-edge light catch. */
  highlight: "rgba(255, 255, 255, 0.2)",
} as const;

/**
 * Elevation. Only three uses: the membership card, switch thumbs, and floating
 * surfaces (sheets, menus, dialogs, toasts). Everything else uses borders and
 * surface contrast.
 */
export const shadows = {
  membershipCard: "0 24px 60px -20px rgba(0, 0, 0, 0.6)",
  thumb: "0 3px 8px rgba(0, 0, 0, 0.25)",
  overlay: { dark: "0 16px 48px -12px rgba(0, 0, 0, 0.7)", light: "0 16px 48px -12px rgba(0, 0, 0, 0.18)" },
} as const;

/**
 * iOS-like corner radii (px).
 * sm: sidebar rows · md: (reserved) · control: buttons md, fields, alerts, choice rows ·
 * lg: list groups, empty states, button lg · card: cards and tiles · xl: membership card ·
 * pill: chips, badges, small buttons, switches.
 */
export const radius = { sm: 8, md: 12, control: 14, lg: 16, xl: 22, card: 20, pill: 999 } as const;

/** 4-pt spacing scale (px). */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

/**
 * iOS Dynamic Type "Large" defaults (px / line-height px). Inputs use ≥ 16px
 * so iOS Safari never zooms on focus.
 */
export const type = {
  largeTitle: { size: 34, line: 41, weight: 700, tracking: -0.4 },
  title1: { size: 28, line: 34, weight: 700, tracking: -0.3 },
  title2: { size: 22, line: 28, weight: 700, tracking: -0.2 },
  title3: { size: 20, line: 25, weight: 600, tracking: -0.2 },
  headline: { size: 17, line: 22, weight: 600, tracking: -0.2 },
  body: { size: 17, line: 22, weight: 400, tracking: -0.2 },
  callout: { size: 16, line: 21, weight: 400, tracking: -0.2 },
  subhead: { size: 15, line: 20, weight: 400, tracking: -0.1 },
  footnote: { size: 13, line: 18, weight: 400, tracking: 0 },
  caption: { size: 12, line: 16, weight: 400, tracking: 0 },
  caption2: { size: 11, line: 13, weight: 400, tracking: 0.06 },
} as const;

/** Minimum touch target (Apple HIG). */
export const MIN_TOUCH_TARGET = 44;

/**
 * Component sizes (px). Heights that are part of the visual language; every
 * interactive one is ≥ MIN_TOUCH_TARGET or sits inside a larger hit area.
 */
export const sizes = {
  /** Small (pill) button. Visual 36px — pad its hit area to 44px when isolated. */
  buttonSm: 36,
  /** Default button and text field / select (iOS 50pt). */
  control: 50,
  /** Large primary button. */
  controlLg: 54,
  /** ListRow minimum height. */
  row: 48,
  /** RadioRow / CheckboxRow / SwitchRow / TabBar item minimum height. */
  choiceRow: 52,
  /** CheckboxChip minimum height (visual); 44px hit area via padding. */
  chip: 40,
  /** SegmentedControl segment minimum height (visual). */
  segment: 34,
  /** Switch track and thumb (iOS UISwitch). */
  switchWidth: 51,
  switchHeight: 31,
  switchThumb: 27,
  /** Choice indicator (radio/checkbox). */
  indicator: 22,
  /** Top bar content height (below the safe area). */
  topBar: 48,
  /** Tab bar content height (above the home indicator). */
  tabBar: 52,
  /** Desktop sidebar width. */
  sidebar: 248,
  /** Membership card max width. */
  membershipCard: 420,
} as const;

/** Motion. Reduced motion collapses every duration to ~0 (see globals.css). */
export const motion = {
  fastMs: 150,
  baseMs: 240,
  slowMs: 500,
  spring: "cubic-bezier(0.32, 0.72, 0, 1)",
  /** Press feedback on buttons and tappable rows. */
  pressScale: 0.98,
  pressOpacity: 0.85,
  /** Backdrop blur for translucent bars (px). The only blur in the system. */
  barBlurPx: 20,
} as const;

export const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter Variable", system-ui, "Segoe UI", Roboto, sans-serif',
  /** Brand moments only (wordmark, membership card). */
  serif: '"Newsreader Variable", "New York", ui-serif, Georgia, serif',
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace',
} as const;
