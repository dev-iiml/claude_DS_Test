import type { ProviderKind } from "./types";

/**
 * Errors raised by provider adapters. The class decides how the routing layer
 * treats a failure:
 * - `unavailable` / `timeout` — the provider is unhealthy; counts towards
 *   opening its circuit.
 * - `rejected` — the provider worked but refused this request (bad code,
 *   unknown reference); never counts against provider health.
 * Unknown errors (network failures, SDK crashes) are treated as `unavailable`.
 * Messages must never contain request payloads or personal data.
 */
export type ProviderErrorClass = "unavailable" | "timeout" | "rejected";

export class ProviderError extends Error {
  constructor(
    readonly errorClass: ProviderErrorClass,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function classifyProviderError(error: unknown): ProviderErrorClass {
  return error instanceof ProviderError ? error.errorClass : "unavailable";
}

/**
 * Raised by the routing layer before any vendor is called: the capability is
 * paused by the kill switch, has no healthy configuration, or none exists.
 */
export type ProviderRoutingCode = "paused" | "unavailable" | "not_configured";

export class ProviderRoutingError extends Error {
  constructor(
    readonly code: ProviderRoutingCode,
    readonly kind: ProviderKind,
  ) {
    super(`provider ${kind} ${code}`);
    this.name = "ProviderRoutingError";
  }
}

/** True when a capability is temporarily unavailable (show "try again later", not a form error). */
export function isProviderOutage(error: unknown): boolean {
  if (error instanceof ProviderRoutingError) return true;
  return error instanceof ProviderError && error.errorClass !== "rejected";
}
