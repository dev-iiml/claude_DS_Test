/** Types for lib.mjs (kept dependency-free JavaScript so it runs with plain Node anywhere). */
export interface DesignSystemLock {
  schema: number;
  release: string;
  releaseChecksum: string;
  source: string;
  pinnedAt: string;
  authorizedBy: string;
  reason: string | null;
  previous: { release: string; releaseChecksum: string } | null;
  modules: Record<string, string>;
  watch: string[];
  files: Record<string, string>;
  history: { action: string; release: string; at: string; by: string; reason: string | null }[];
}
export interface PinCheck {
  errors: string[];
  warnings: string[];
  info: string[];
  lock: DesignSystemLock | null;
}
export const LOCK_FILE: string;
export const MANIFEST: string;
export function sha256(file: string): string;
export function isRuntimeFile(path: string): boolean;
export function readLock(root: string): DesignSystemLock | null;
export function tailwindScansSrcOnly(root: string): Promise<boolean>;
export function checkPin(root: string, options?: { mode?: "enforce" | "warn" | "candidate" }): Promise<PinCheck>;
export function loadPublishedRelease(
  root: string,
  version: string,
): { entry: unknown; files: Record<string, string>; modules: Record<string, string>; watch: string[] };
export function buildLock(
  root: string,
  version: string,
  options: { authorizedBy?: string; reason?: string; now?: Date },
): DesignSystemLock;
export function compareVersions(a: string, b: string): number;
