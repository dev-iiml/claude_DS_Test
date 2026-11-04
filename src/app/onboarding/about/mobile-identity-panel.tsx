"use client";

import { useEffect, useState, useTransition } from "react";

import { CheckboxRow, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { fetchIdentityPrefillAction, sendOtpAction, verifyOtpAction } from "../identity-actions";

export interface PrefillConsent {
  id: string;
  title: string;
  purpose: string;
  body: string;
  version: number;
}

export interface PanelInitialState {
  maskedMobile: string | null;
  prefill: { fullName: string; panMasked: string } | null;
}

/**
 * Optional identity prefill: verify mobile by OTP → consent → fetch the
 * PAN-linked name. The creator can skip this and type their legal name.
 */
export function MobileIdentityPanel({
  initial,
  consent,
  onUseName,
}: {
  initial: PanelInitialState;
  consent: PrefillConsent | null;
  onUseName: (name: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [maskedMobile, setMaskedMobile] = useState(initial.maskedMobile);
  const [prefill, setPrefill] = useState(initial.prefill);
  const [mobile, setMobile] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; sentTo: string; demoCode: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const mobileValid = /^[6-9][0-9]{9}$/.test(mobile.replace(/\D/g, ""));

  const send = () =>
    startTransition(async () => {
      setError(null);
      const r = await sendOtpAction(mobile);
      if (!r.ok) return setError(r.message);
      setChallenge({ id: r.data.challengeId, sentTo: r.data.maskedMobile, demoCode: r.data.demoCode });
      setCode("");
      setCooldown(r.data.resendAfterSeconds);
    });

  const verify = () =>
    startTransition(async () => {
      if (!challenge) return;
      setError(null);
      const r = await verifyOtpAction(challenge.id, code);
      if (!r.ok) return setError(r.message);
      setMaskedMobile(r.data.maskedMobile);
      setChallenge(null);
    });

  const fetchName = () =>
    startTransition(async () => {
      if (!consent) return;
      setError(null);
      const r = await fetchIdentityPrefillAction(consent.id);
      if (!r.ok) return setError(r.message);
      setPrefill(r.data);
      onUseName(r.data.fullName);
    });

  return (
    <section
      aria-labelledby="identity-panel-heading"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="identity-panel-heading" className="text-subhead font-semibold">
          Prefill your legal name
        </h2>
        <StatusBadge tone={maskedMobile ? "success" : "neutral"}>
          {maskedMobile ? `Mobile verified · ${maskedMobile}` : "Optional"}
        </StatusBadge>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!maskedMobile && !challenge ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="mobile">Mobile number</Label>
          <p id="mobile-description" className="-mt-0.5 text-sm text-ink-muted">
            We&rsquo;ll send a one-time code to confirm it&rsquo;s yours.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-subtle"
              >
                +91
              </span>
              <Input
                id="mobile"
                aria-describedby="mobile-description"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={14}
                className="pl-12"
                value={mobile}
                onChange={(e) => setMobile(e.currentTarget.value.replace(/[^\d\s]/g, ""))}
              />
            </div>
            <Button type="button" variant="secondary" disabled={!mobileValid || pending} onClick={send}>
              {pending ? "Sending…" : "Send code"}
            </Button>
          </div>
        </div>
      ) : null}

      {challenge ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="otp">Enter the 6-digit code sent to {challenge.sentTo}</Label>
          {challenge.demoCode ? (
            <p className="text-sm text-info">Demo mode: no SMS is sent. Use code {challenge.demoCode}.</p>
          ) : null}
          <div className="flex gap-2">
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="flex-1 font-mono tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ""))}
            />
            <Button type="button" variant="secondary" disabled={code.length !== 6 || pending} onClick={verify}>
              {pending ? "Checking…" : "Verify"}
            </Button>
          </div>
          <div className="flex gap-4 text-sm">
            <button
              type="button"
              className="text-ink-muted underline underline-offset-4 disabled:no-underline disabled:opacity-60"
              disabled={cooldown > 0 || pending}
              onClick={send}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              className="text-ink-muted underline underline-offset-4"
              onClick={() => setChallenge(null)}
            >
              Change number
            </button>
          </div>
        </div>
      ) : null}

      {maskedMobile && prefill ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-elevated px-4 py-3 text-sm">
          <p>
            <span className="text-ink-muted">Name on record:</span>{" "}
            <span className="font-medium">{prefill.fullName}</span>
            <span className="ml-3 font-mono text-xs text-ink-muted">PAN {prefill.panMasked}</span>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onUseName(prefill.fullName)}>
            Use this name
          </Button>
        </div>
      ) : null}

      {maskedMobile && !prefill && consent ? (
        <div className="flex flex-col gap-3">
          <details className="rounded-control bg-elevated px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">
              {consent.title} consent · version {consent.version}
            </summary>
            <p className="mt-2 font-medium">Purpose: {consent.purpose}</p>
            <div id="prefill-consent-body" className="mt-2 flex flex-col gap-2 text-ink-muted">
              {consent.body.split("\n\n").map((p) => (
                <p key={p.slice(0, 24)}>{p}</p>
              ))}
            </div>
          </details>
          <CheckboxRow
            label="I agree to CreatorCo fetching my name and PAN-linked details for this purpose"
            checked={agree}
            onChange={(e) => setAgree(e.currentTarget.checked)}
          />
          <div>
            <Button type="button" variant="secondary" disabled={!agree || pending} onClick={fetchName}>
              {pending ? "Fetching…" : "Fetch my legal name"}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-ink-subtle">
        We use your mobile to find the name on your PAN, and keep only a masked PAN. Prefer not to? Skip this and type
        your legal name below.
      </p>
    </section>
  );
}
