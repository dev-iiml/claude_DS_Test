import type { ChangeRequestView, ConfigView, KindView } from "@/modules/integrations";

/** Display helpers for the /ops console. */

export const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export function kindStatus(k: KindView): { label: string; tone: Tone } {
  if (k.route?.paused) return { label: "Paused", tone: "danger" };
  if (k.selection.status === "not_configured") return { label: "Not configured", tone: "warning" };
  if (k.selection.status === "unavailable") return { label: "Unavailable", tone: "danger" };
  if (k.selection.status === "ok" && k.selection.via === "fallback") return { label: "On fallback", tone: "warning" };
  return { label: "Serving", tone: "success" };
}

export const UNAVAILABLE_COPY: Record<string, string> = {
  disabled: "The primary config is disabled.",
  misconfigured: "The primary config is missing an adapter or a secret env var.",
  mock_in_production: "Mock configs never serve production traffic.",
  circuit_open: "The primary's circuit is open and there is no healthy fallback.",
};

export function circuitTone(c: ConfigView["circuit"]): Tone {
  return c === "closed" ? "success" : c === "half_open" ? "warning" : "danger";
}

export const CIRCUIT_LABEL: Record<ConfigView["circuit"], string> = {
  closed: "Circuit closed",
  half_open: "Probing",
  open: "Circuit open",
};

export const HEALTH_TONE: Record<ConfigView["health"], Tone> = {
  unknown: "neutral",
  ok: "success",
  degraded: "warning",
  down: "danger",
};

export const MODE_TONE: Record<ConfigView["mode"], Tone> = { mock: "neutral", sandbox: "info", live: "brand" };

export const ACTION_LABEL: Record<string, string> = {
  create_config: "New config",
  update_config: "Edit config",
  set_route: "Change route",
  pause_kind: "Kill switch",
  resume_kind: "Lift kill switch",
};

export const STATUS_TONE: Record<ChangeRequestView["status"], Tone> = {
  pending: "warning",
  applied: "success",
  rejected: "danger",
  cancelled: "neutral",
  expired: "neutral",
  superseded: "neutral",
};

/** One-line description of what a change does (no secret values exist to show). */
export function describeChange(c: ChangeRequestView, keys: Map<string, string>): string {
  const p = c.payload;
  switch (c.action) {
    case "create_config":
      return [
        `${String(p.key)} · ${String(p.adapter)} · ${String(p.mode)}${p.enabled ? " · enabled" : ""}`,
        `settings ${JSON.stringify(p.settings ?? {})}`,
        `secrets ${JSON.stringify(p.secretRefs ?? {})}`,
      ].join(" · ");
    case "update_config": {
      const changes = (p.changes ?? {}) as Record<string, unknown>;
      const parts = Object.entries(changes).map(([k, v]) =>
        k === "settings" || k === "secretRefs" ? `${k} → ${JSON.stringify(v)}` : `${k} → ${String(v)}`,
      );
      return `${c.configKey ?? "config"}: ${parts.join(", ")}`;
    }
    case "set_route": {
      const primary = keys.get(String(p.primaryConfigId)) ?? "?";
      const fallback = p.fallbackConfigId ? (keys.get(String(p.fallbackConfigId)) ?? "?") : "none";
      return `primary ${primary} · fallback ${fallback}`;
    }
    case "pause_kind":
      return "Stop all calls";
    case "resume_kind":
      return "Resume calls";
    default:
      return c.action;
  }
}
