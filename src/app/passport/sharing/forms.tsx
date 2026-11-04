"use client";

import { useActionState, useState } from "react";

import {
  CheckboxRow,
  ChoiceFieldset,
  ConsentText,
  FieldError,
  FormField,
  FormMessage,
  RadioRow,
  SegmentedControl,
  SwitchRow,
} from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input, fieldClasses } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { initialFormState, type FormState } from "@/lib/forms";
import {
  BIO_MAX,
  FIELD_RULES,
  PASSPORT_FIELDS,
  type FieldTier,
  type FieldTiers,
  type UnlockAudience,
} from "@/modules/public-passport/domain";
import { composePreview, type PublicPassportView } from "@/modules/public-passport/view";

import { PassportRender } from "../../p/_components/passport-render";
import { audienceAction, bioAction, changeSlugAction, fieldsAction, optionsAction, publishAction } from "./actions";

type Definition = { id: string; title: string; purpose: string; body: string; version: number };

const TIER_LABELS: Record<FieldTier, string> = { public: "Everyone", unlocked: "Unlockers", hidden: "Hidden" };

function ConsentCard({
  id,
  definition,
  label,
  error,
}: {
  id: string;
  definition: Definition;
  label: string;
  error?: string[];
}) {
  return (
    <Card>
      <CardContent>
        <ConsentText id={`${id}-text`} definition={definition} />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <input type="hidden" name="consentDefinitionId" value={definition.id} />
        <CheckboxRow
          name="agree"
          label={label}
          aria-describedby={[`${id}-text`, error ? `${id}-error` : null].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
        />
        <FieldError id={`${id}-error`} errors={error} />
      </CardFooter>
    </Card>
  );
}

function SlugInput({ state, defaultValue }: { state: FormState; defaultValue: string }) {
  return (
    <FormField
      id="slug"
      label="Your link"
      required
      description="3–30 lower-case letters, numbers and hyphens. If you change it later, the old link forwards for 30 days."
      errors={state.status === "error" && !state.fieldErrors?.agree ? [state.message ?? ""] : undefined}
    >
      {(a11y) => (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-subhead text-ink-muted">/p/</span>
          <Input
            {...a11y}
            name="slug"
            defaultValue={typeof state.values?.slug === "string" ? state.values.slug : defaultValue}
            autoComplete="off"
            spellCheck={false}
            maxLength={30}
          />
        </div>
      )}
    </FormField>
  );
}

export function PublishForm({ suggestedSlug, definition }: { suggestedSlug: string; definition: Definition | null }) {
  const [state, action] = useActionState(publishAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <SlugInput state={state} defaultValue={suggestedSlug} />
      {definition ? (
        <ConsentCard
          id="public-passport-consent"
          definition={definition}
          label="I agree to publishing my public Passport"
          error={state.fieldErrors?.agree}
        />
      ) : null}
      <div>
        <SubmitButton pendingLabel="Publishing…">Publish my Passport</SubmitButton>
      </div>
    </form>
  );
}

export function SlugForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(changeSlugAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <SlugInput state={state} defaultValue={slug} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Change link
        </SubmitButton>
      </div>
    </form>
  );
}

export function BioForm({ bio }: { bio: string | null }) {
  const [state, action] = useActionState(bioAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormField
        id="bio"
        label="Short bio"
        description={`Up to ${BIO_MAX} characters. Leave out phone numbers, email addresses and ID numbers.`}
        errors={state.status === "error" ? [state.message ?? ""] : undefined}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            name="bio"
            rows={3}
            maxLength={BIO_MAX}
            defaultValue={bio ?? ""}
            className={cn(fieldClasses, "h-auto py-3")}
          />
        )}
      </FormField>
      <div>
        <SubmitButton variant="secondary">Save bio</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Who sees each field, with a live preview of what a stranger and an
 * unlocker would see. The preview is recomposed in the browser from views the
 * server already built (bands only) — the same result as the public page.
 */
export function FieldsForm({
  tiers: saved,
  open,
  hasPhoto,
}: {
  tiers: FieldTiers;
  open: PublicPassportView;
  hasPhoto: boolean;
}) {
  const [state, action] = useActionState(fieldsAction, initialFormState);
  const [tiers, setTiers] = useState<FieldTiers>(saved);
  const [as, setAs] = useState<"locked" | "unlocked">("locked");
  const preview = composePreview(open, tiers, as);
  const changed = PASSPORT_FIELDS.some((f) => tiers[f] !== saved[f]);

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <FormMessage state={state} />
        <ul className="flex flex-col divide-y divide-line rounded-lg bg-surface ring-1 ring-line ring-inset">
          {PASSPORT_FIELDS.map((field) => {
            const rule = FIELD_RULES[field];
            return (
              <li key={field} className="flex flex-col gap-3 px-4 py-3.5">
                <div>
                  <p className="text-body font-medium">{rule.label}</p>
                  <p className="text-footnote leading-snug text-ink-muted">{rule.detail}</p>
                </div>
                {rule.allowed.length > 1 ? (
                  <SegmentedControl
                    name={`tier.${field}`}
                    legend={`Who sees ${rule.label.toLowerCase()}`}
                    options={rule.allowed.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
                    value={tiers[field]}
                    onChange={(v) => setTiers((prev) => ({ ...prev, [field]: v as FieldTier }))}
                  />
                ) : (
                  <p className="text-subhead text-ink-subtle">Always shown to everyone</p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-footnote text-ink-muted">
          Everyone: anyone with your link. Unlockers: people with an access code you gave them, and verified brands if
          you allow them. Amounts only ever appear as bands, never exact figures.
        </p>
        <div>
          <SubmitButton pendingLabel="Saving…">{changed ? "Save changes" : "Save"}</SubmitButton>
        </div>
      </form>

      <section aria-labelledby="preview-heading" className="flex flex-col gap-4 xl:sticky xl:top-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="preview-heading" className="text-headline font-semibold">
            Preview
          </h3>
          <SegmentedControl
            name="preview-as"
            legend="Preview as"
            options={[
              { value: "locked", label: "A stranger" },
              { value: "unlocked", label: "An unlocker" },
            ]}
            value={as}
            onChange={(v) => setAs(v as "locked" | "unlocked")}
          />
        </div>
        <div className="rounded-lg bg-paper p-5 ring-1 ring-line ring-inset" aria-live="polite">
          <PassportRender view={preview} photoSrc={hasPhoto ? "/passport/sharing/photo" : null} logoBase={null} />
        </div>
        <p className="text-footnote text-ink-muted">
          {changed ? "Preview of your unsaved changes. " : ""}Brand logos appear only where the brand&apos;s verified
          organisation has approved one.
        </p>
      </section>
    </div>
  );
}

export function OptionsForm({
  indexable,
  includePrivateInTotals,
}: {
  indexable: boolean;
  includePrivateInTotals: boolean;
}) {
  const [state, action] = useActionState(optionsAction, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <div className="flex flex-col divide-y divide-line rounded-lg bg-surface px-4 ring-1 ring-line ring-inset">
        <SwitchRow
          name="indexable"
          label="Let search engines list my Passport"
          description="Off: your page asks search engines not to index it. Only the public tier is ever visible to them."
          defaultChecked={indexable}
        />
        <SwitchRow
          name="includePrivateInTotals"
          label="Count private work in totals"
          description="Private collaborations never appear by name. When on, they count towards brand-work numbers and bands."
          defaultChecked={includePrivateInTotals}
        />
      </div>
      <div>
        <SubmitButton variant="secondary">Save options</SubmitButton>
      </div>
    </form>
  );
}

export function AudienceForm({
  audience,
  discoverable,
  definition,
  discoveryOn,
}: {
  audience: UnlockAudience;
  discoverable: boolean;
  definition: Definition | null;
  discoveryOn: boolean;
}) {
  const [state, action] = useActionState(audienceAction, initialFormState);
  const [choice, setChoice] = useState<UnlockAudience>(
    (state.values?.audience as UnlockAudience | undefined) ?? audience,
  );
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <ChoiceFieldset id="audience" legend="Who can unlock" required>
        <RadioRow
          name="audience"
          value="code_holders_only"
          label="Only people with an access code"
          description="You create codes and choose who gets them."
          checked={choice === "code_holders_only"}
          onChange={() => setChoice("code_holders_only")}
        />
        <RadioRow
          name="audience"
          value="code_holders_and_verified_brands"
          label="Code holders and verified brands"
          description="Brands and agencies CreatorCo has verified can also unlock. Every unlock appears in your access log."
          checked={choice === "code_holders_and_verified_brands"}
          onChange={() => setChoice("code_holders_and_verified_brands")}
        />
      </ChoiceFieldset>
      {discoveryOn ? (
        <div className="rounded-lg bg-surface px-4 ring-1 ring-line ring-inset">
          <SwitchRow
            name="discoverable"
            label="Let verified brands find me"
            description="Verified brands can find your public tier when they search. Needs verified brands above."
            defaultChecked={discoverable}
            disabled={choice !== "code_holders_and_verified_brands"}
          />
        </div>
      ) : null}
      {definition ? (
        <ConsentCard
          id="passport-unlock-consent"
          definition={definition}
          label="I agree to letting the people I choose unlock my Passport"
          error={state.fieldErrors?.agree}
        />
      ) : null}
      <div>
        <SubmitButton variant="secondary">Save</SubmitButton>
      </div>
    </form>
  );
}
