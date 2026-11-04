"use client";

import { useActionState } from "react";

import {
  CheckboxChip,
  CheckboxRow,
  ChoiceFieldset,
  ConsentText,
  FieldError,
  FormField,
  FormFooter,
  FormMessage,
  RadioRow,
  SwitchRow,
} from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input, fieldClasses } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { initialFormState, type FormState } from "@/lib/forms";
import {
  BILLED_PARTY_TYPES,
  BRAND_INDUSTRIES,
  BRAND_WORK_PLATFORMS,
  DELIVERABLE_TYPES,
} from "@/modules/brand-work/domain";
import { BILLED_PARTY_LABELS, DELIVERABLE_LABELS, PLATFORM_LABELS } from "@/modules/brand-work/presentation";

import { createRecordAction, updateRecordAction } from "./actions";

export interface RecordFormSaved {
  endBrandName: string;
  billedPartyType: string;
  billedPartyName: string;
  industryCode: string | null;
  platforms: string[];
  deliverables: string[];
  visibility: string;
  description: string;
  deliverablesSummary: string | null;
  workDate: string;
  invoiceDate: string | null;
  invoiceAmountRupees: string | null;
}

type Definition = { id: string; title: string; purpose: string; body: string; version: number };

const text = (state: FormState, key: string, saved: string | null | undefined) => {
  const v = state.values?.[key];
  return typeof v === "string" ? v : (saved ?? "");
};
const list = (state: FormState, key: string, saved: string[]) => {
  const v = state.values?.[key];
  return Array.isArray(v) ? v : saved;
};

export function RecordForm({
  recordId,
  saved,
  definition,
  today,
}: {
  recordId?: string;
  saved?: RecordFormSaved;
  /** The brand-work consent to agree to, when not yet given. */
  definition: Definition | null;
  today: string;
}) {
  const [state, action] = useActionState(recordId ? updateRecordAction : createRecordAction, initialFormState);
  const e = state.fieldErrors ?? {};
  const billed = text(state, "billedPartyType", saved?.billedPartyType ?? "brand");
  const platforms = list(state, "platforms", saved?.platforms ?? []);
  const deliverables = list(state, "deliverables", saved?.deliverables ?? []);
  const isPrivate = state.values ? state.values.visibility === "private" : saved?.visibility === "private";

  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <FormMessage state={state} />
      {recordId ? <input type="hidden" name="recordId" value={recordId} /> : null}

      <FormField
        id="endBrandName"
        label="Brand"
        description="The brand the work was for, even if an agency billed it."
        errors={e.endBrandName}
        required
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="endBrandName"
            maxLength={60}
            autoComplete="off"
            defaultValue={text(state, "endBrandName", saved?.endBrandName)}
          />
        )}
      </FormField>

      <ChoiceFieldset id="billedPartyType" legend="Who did you bill?" errors={e.billedPartyType} required>
        {BILLED_PARTY_TYPES.map((t) => (
          <RadioRow
            key={t}
            name="billedPartyType"
            value={t}
            label={BILLED_PARTY_LABELS[t]}
            defaultChecked={billed === t}
          />
        ))}
      </ChoiceFieldset>

      <FormField
        id="billedPartyName"
        label="Agency or platform name"
        description="Only if you billed an agency or platform. We still credit the brand."
        errors={e.billedPartyName}
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="billedPartyName"
            maxLength={60}
            autoComplete="off"
            defaultValue={billed === "brand" ? "" : text(state, "billedPartyName", saved?.billedPartyName)}
          />
        )}
      </FormField>

      <FormField
        id="industryCode"
        label="Brand industry"
        description="Your best guess — a reviewer confirms it."
        errors={e.industryCode}
      >
        {(a11y) => (
          <NativeSelect
            {...a11y}
            name="industryCode"
            defaultValue={text(state, "industryCode", saved?.industryCode)}
            className="sm:max-w-sm"
          >
            <option value="">Not sure</option>
            {BRAND_INDUSTRIES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <ChoiceFieldset
        id="platforms"
        legend="Platforms"
        description="Choose all that apply."
        errors={e.platforms}
        required
      >
        <div className="flex flex-wrap gap-2">
          {BRAND_WORK_PLATFORMS.map((p) => (
            <CheckboxChip
              key={p}
              name="platforms"
              value={p}
              label={PLATFORM_LABELS[p] ?? p}
              defaultChecked={platforms.includes(p)}
            />
          ))}
        </div>
      </ChoiceFieldset>

      <ChoiceFieldset
        id="deliverables"
        legend="Deliverables"
        description="Choose all that apply."
        errors={e.deliverables}
        required
      >
        <div className="flex flex-wrap gap-2">
          {DELIVERABLE_TYPES.map((d) => (
            <CheckboxChip
              key={d}
              name="deliverables"
              value={d}
              label={DELIVERABLE_LABELS[d]}
              defaultChecked={deliverables.includes(d)}
            />
          ))}
        </div>
      </ChoiceFieldset>

      <FormField
        id="description"
        label="What was the work?"
        description="A few words, e.g. “Autumn launch campaign”."
        errors={e.description}
        required
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="description"
            maxLength={280}
            autoComplete="off"
            defaultValue={text(state, "description", saved?.description)}
          />
        )}
      </FormField>

      <FormField
        id="deliverablesSummary"
        label="Deliverables in detail"
        description="Optional, e.g. “2 reels and 3 stories”."
        errors={e.deliverablesSummary}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            name="deliverablesSummary"
            rows={2}
            maxLength={280}
            className={cn(fieldClasses, "h-auto py-3")}
            defaultValue={text(state, "deliverablesSummary", saved?.deliverablesSummary)}
          />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <FormField id="workDate" label="When was the work?" errors={e.workDate} required>
          {(a11y) => (
            <Input
              {...a11y}
              type="date"
              name="workDate"
              max={today}
              defaultValue={text(state, "workDate", saved?.workDate)}
            />
          )}
        </FormField>
        <FormField id="invoiceDate" label="Invoice date" errors={e.invoiceDate}>
          {(a11y) => (
            <Input
              {...a11y}
              type="date"
              name="invoiceDate"
              defaultValue={text(state, "invoiceDate", saved?.invoiceDate)}
            />
          )}
        </FormField>
      </div>

      <FormField
        id="invoiceAmountRupees"
        label="Invoice amount (₹)"
        description="Optional. Shown only to you and the reviewers; never to brands, partners or in analytics, and it never changes your points."
        errors={e.invoiceAmountRupees}
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="invoiceAmountRupees"
            inputMode="numeric"
            autoComplete="off"
            className="tabular-nums sm:max-w-xs"
            defaultValue={text(state, "invoiceAmountRupees", saved?.invoiceAmountRupees)}
          />
        )}
      </FormField>

      <SwitchRow
        name="private"
        label="Keep this collaboration private"
        description="For NDA or confidential work. It still counts towards your brand signals, but the brand's name never appears on your Passport or to CreatorCo's partnerships team."
        defaultChecked={isPrivate}
      />

      {definition ? (
        <Card>
          <CardContent>
            <ConsentText id="brand-work-consent-text" definition={definition} />
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <input type="hidden" name="consentDefinitionId" value={definition.id} />
            <CheckboxRow
              name="agree"
              label="I agree to CreatorCo storing and verifying my brand-work records"
              aria-describedby={["brand-work-consent-text", e.agree ? "agree-error" : null].filter(Boolean).join(" ")}
              aria-invalid={e.agree ? true : undefined}
            />
            <FieldError id="agree-error" errors={e.agree} />
          </CardFooter>
        </Card>
      ) : null}

      <FormFooter>
        <SubmitButton size="lg" className="w-full sm:w-auto" pendingLabel="Saving…">
          {recordId ? "Save changes" : "Save and add documents"}
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
