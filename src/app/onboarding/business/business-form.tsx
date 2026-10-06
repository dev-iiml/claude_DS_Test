"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { ChoiceFieldset, FormField, FormFooter, FormMessage, RadioRow, StatusBadge } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormState } from "@/lib/forms";
import type { GstRegistrationView } from "@/modules/creator-profile/gst-registration";
import { explainGstin } from "@/modules/creator-profile/gstin";

import { updateBusinessAction } from "@/app/passport/actions";

import { saveBusinessAction } from "../actions";
import { findGstRegistrationsAction, verifyGstinAction } from "../identity-actions";
import { textValue } from "../_lib/form-values";

interface LegalFormOption {
  value: string;
  label: string;
  description: string;
  supported: boolean;
}

const STATUS_COPY: Record<GstRegistrationView["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspended", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

function RegistrationDetails({ r }: { r: GstRegistrationView }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {r.legalName ? (
        <>
          <dt className="text-ink-muted">Legal name</dt>
          <dd>{r.legalName}</dd>
        </>
      ) : null}
      {r.tradeName ? (
        <>
          <dt className="text-ink-muted">Trade name</dt>
          <dd>{r.tradeName}</dd>
        </>
      ) : null}
      {r.constitution ? (
        <>
          <dt className="text-ink-muted">Constitution</dt>
          <dd>{r.constitution}</dd>
        </>
      ) : null}
      {r.registeredOn ? (
        <>
          <dt className="text-ink-muted">Registered on</dt>
          <dd>{r.registeredOn}</dd>
        </>
      ) : null}
    </dl>
  );
}

export function BusinessForm({
  mode = "onboarding",
  legalForms,
  gstStatuses,
  saved,
  lookupAvailable,
}: {
  /** `passport` saves edits to a completed profile. */
  mode?: "onboarding" | "passport";
  legalForms: LegalFormOption[];
  gstStatuses: { value: string; label: string }[];
  saved: {
    legalForm: string | null;
    gstStatus: string | null;
    gstin: string | null;
    registration: GstRegistrationView | null;
  };
  /** Mobile verified and identity-prefill consent given. */
  lookupAvailable: boolean;
}) {
  const [state, action] = useActionState(
    mode === "passport" ? updateBusinessAction : saveBusinessAction,
    initialFormState,
  );
  const e = state.fieldErrors ?? {};
  const [gstStatus, setGstStatus] = useState(() => textValue(state, "gstStatus", saved.gstStatus));
  const [legalForm, setLegalForm] = useState(() => textValue(state, "legalForm", saved.legalForm));
  const [gstin, setGstin] = useState(saved.gstin ?? "");
  const [verified, setVerified] = useState<{ gstin: string; registration: GstRegistrationView | null } | null>(
    saved.gstin ? { gstin: saved.gstin, registration: saved.registration } : null,
  );
  const [lookup, setLookup] = useState<GstRegistrationView[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [searching, startSearch] = useTransition();
  const lastChecked = useRef<string | null>(saved.gstin);

  const supported = legalForms.filter((f) => f.supported);
  const unsupported = legalForms.filter((f) => !f.supported);
  const feedback = explainGstin(gstin);

  const validGstin = feedback.state === "valid" ? feedback.gstin : null;

  // Check the registry once a complete, well-formed GSTIN is typed (debounced).
  useEffect(() => {
    if (!validGstin || lastChecked.current === validGstin) return;
    const target = validGstin;
    const t = setTimeout(() => {
      lastChecked.current = target;
      startCheck(async () => {
        const r = await verifyGstinAction(target);
        setVerified(r.ok ? { gstin: target, registration: r.data.registration } : null);
        if (!r.ok) setNotice(r.message);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [validGstin]);

  const applyRegistration = (r: GstRegistrationView) => {
    setGstStatus("registered");
    setGstin(r.gstin);
    lastChecked.current = r.gstin;
    setVerified({ gstin: r.gstin, registration: r });
    if (r.suggestedLegalForm && r.pilotSupported) setLegalForm(r.suggestedLegalForm);
  };

  const findRegistrations = () =>
    startSearch(async () => {
      setNotice(null);
      const r = await findGstRegistrationsAction();
      if (!r.ok) return setNotice(r.message);
      setLookup(r.data.registrations);
      const firstActive = r.data.registrations.find((x) => x.status === "active");
      if (r.data.registrations.length === 1 && firstActive) applyRegistration(firstActive);
    });

  const currentVerification = verified && verified.gstin === validGstin ? verified : null;
  const reg = currentVerification?.registration ?? null;

  return (
    <form action={action} className="flex flex-col gap-9" noValidate>
      <FormMessage state={state} />

      {/* GST lookup by PAN (via verified mobile) */}
      <section
        aria-labelledby="gst-lookup-heading"
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="gst-lookup-heading" className="text-subhead font-semibold">
          Find your GST registrations
        </h2>
        {lookupAvailable ? (
          <>
            <p className="text-sm text-ink-muted">
              We&rsquo;ll check the GST registry for registrations linked to your PAN. Your full PAN isn&rsquo;t stored.
            </p>
            <div>
              <Button type="button" variant="secondary" onClick={findRegistrations} disabled={searching}>
                {searching ? "Searching…" : lookup ? "Search again" : "Find my GST registrations"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            <Link href="/onboarding/about" className="underline underline-offset-4">
              Verify your mobile and fetch your details
            </Link>{" "}
            on the About you step to look this up automatically — or fill in the form below.
          </p>
        )}
        {notice ? <Alert tone="warning">{notice}</Alert> : null}
        {lookup && lookup.length === 0 ? (
          <Alert tone="info">
            No GST registrations are linked to your PAN. If that&rsquo;s right, choose &ldquo;Not registered for
            GST&rdquo; below.
          </Alert>
        ) : null}
        {lookup && lookup.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="GST registrations found">
            {lookup.map((r) => (
              <li key={r.gstin} className="flex flex-col gap-3 rounded-control bg-elevated p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm tracking-wider">{r.gstin}</span>
                  <StatusBadge tone={STATUS_COPY[r.status].tone}>{STATUS_COPY[r.status].label}</StatusBadge>
                </div>
                <RegistrationDetails r={r} />
                {!r.pilotSupported ? (
                  <p className="text-sm text-warning">
                    This registration&rsquo;s business type isn&rsquo;t supported in the current pilot.
                  </p>
                ) : r.status === "cancelled" ? null : (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant={gstin === r.gstin ? "primary" : "secondary"}
                      aria-pressed={gstin === r.gstin}
                      onClick={() => applyRegistration(r)}
                    >
                      {gstin === r.gstin ? "Selected" : "Use this GSTIN"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <ChoiceFieldset id="legalForm" legend="Legal form" required errors={e.legalForm}>
        <div className="flex flex-col gap-2">
          {supported.map((f) => (
            <RadioRow
              key={f.value}
              name="legalForm"
              value={f.value}
              label={f.label}
              description={f.description}
              checked={legalForm === f.value}
              onChange={() => setLegalForm(f.value)}
              required
            />
          ))}
        </div>
        <details className="group rounded-control bg-elevated px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-muted">Operating through a firm or company?</summary>
          <p className="mt-2 text-ink-muted">
            These are not supported in the current pilot. We&rsquo;ll let you know when they are.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {unsupported.map((f) => (
              <li key={f.value}>
                <RadioRow
                  name="legalForm"
                  value={f.value}
                  label={f.label}
                  description="Not supported in current pilot"
                  disabled
                />
              </li>
            ))}
          </ul>
        </details>
      </ChoiceFieldset>

      <ChoiceFieldset
        id="gstStatus"
        legend="GST registration"
        required
        description="Choose what's true today. CreatorCo doesn't make tax determinations."
        errors={e.gstStatus}
      >
        <div className="flex flex-col gap-2">
          {gstStatuses.map((g) => (
            <RadioRow
              key={g.value}
              name="gstStatus"
              value={g.value}
              label={g.label}
              checked={gstStatus === g.value}
              onChange={() => setGstStatus(g.value)}
              required
            />
          ))}
        </div>
      </ChoiceFieldset>

      {gstStatus === "registered" ? (
        <div className="flex flex-col gap-3">
          <FormField
            id="gstin"
            label="GSTIN"
            description="15 characters, e.g. 27ABCDE1234F1Z5. Kept private and never shown to brands."
            errors={e.gstin}
          >
            {(a11y) => (
              <div className="flex flex-col gap-2">
                <Input
                  {...a11y}
                  aria-describedby={[a11y["aria-describedby"], "gstin-feedback"].filter(Boolean).join(" ")}
                  aria-invalid={a11y["aria-invalid"] ?? (feedback.state === "invalid" ? true : undefined)}
                  name="gstin"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={15}
                  className="font-mono tracking-wider uppercase"
                  value={gstin}
                  onChange={(ev) => setGstin(ev.currentTarget.value.toUpperCase().replace(/\s/g, ""))}
                />
                <p
                  id="gstin-feedback"
                  aria-live="polite"
                  className={
                    feedback.state === "invalid"
                      ? "text-sm text-danger"
                      : feedback.state === "valid"
                        ? "text-sm text-success"
                        : "text-sm text-ink-muted"
                  }
                >
                  {feedback.state === "invalid" || feedback.state === "incomplete"
                    ? feedback.message
                    : feedback.state === "valid"
                      ? checking
                        ? "Format looks right — checking the GST registry…"
                        : "Format and check digit look right."
                      : ""}
                </p>
              </div>
            )}
          </FormField>

          {currentVerification && !checking ? (
            reg ? (
              <div
                className="flex flex-col gap-3 rounded-control bg-elevated p-4"
                role="status"
                aria-label="GST registry result"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">GST registry</span>
                  <StatusBadge tone={STATUS_COPY[reg.status].tone}>{STATUS_COPY[reg.status].label}</StatusBadge>
                </div>
                <RegistrationDetails r={reg} />
                {reg.status === "cancelled" ? (
                  <p className="text-sm text-danger">
                    This registration is cancelled. If you&rsquo;re no longer registered, choose &ldquo;Not registered
                    for GST&rdquo;.
                  </p>
                ) : null}
                {reg.status === "suspended" ? (
                  <p className="text-sm text-warning">
                    This registration is suspended. You can continue; we&rsquo;ll note it.
                  </p>
                ) : null}
                {!reg.pilotSupported ? (
                  <p className="text-sm text-warning">
                    This GSTIN belongs to a {reg.constitution}, which isn&rsquo;t supported in the current pilot.
                  </p>
                ) : null}
              </div>
            ) : (
              <Alert tone="danger">We couldn&rsquo;t find this GSTIN in the GST registry. Please check it.</Alert>
            )
          ) : null}
        </div>
      ) : null}

      {gstStatus === "unknown_requires_review" ? (
        <Alert tone="info">
          That&rsquo;s fine. We&rsquo;ll note it for review — you can update your GST status at any time as your
          business grows.
        </Alert>
      ) : null}

      <FormFooter>
        <SubmitButton size="lg">{mode === "passport" ? "Save changes" : "Save and continue"}</SubmitButton>
      </FormFooter>
    </form>
  );
}
