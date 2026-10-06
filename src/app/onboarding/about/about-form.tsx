"use client";

import { useActionState, useState } from "react";

import { CheckboxChip, ChoiceFieldset, FormField, FormFooter, FormMessage, StatusBadge } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { initialFormState } from "@/lib/forms";
import { MAX_OTHER_LANGUAGES } from "@/modules/creator-profile/domain";
import { CITIES_BY_STATE, OTHER_CITY } from "@/modules/creator-profile/india-cities";
import { namesMatch } from "@/modules/identity/name-match";

import { updateAboutAction } from "@/app/passport/actions";

import { saveAboutAction } from "../actions";
import { listValue, textValue } from "../_lib/form-values";
import { MobileIdentityPanel, type PanelInitialState, type PrefillConsent } from "./mobile-identity-panel";

interface Saved {
  legalName: string;
  displayName: string;
  city: string | null;
  state: string | null;
  languages: string[];
  languagesOther: string[];
}

type StateName = keyof typeof CITIES_BY_STATE;

function initialCity(state: string, city: string): { city: string; other: string } {
  if (!city) return { city: "", other: "" };
  const list = CITIES_BY_STATE[state as StateName] ?? [];
  return list.includes(city) ? { city, other: "" } : { city: OTHER_CITY, other: city };
}

export function AboutForm({
  mode = "onboarding",
  saved,
  languages,
  states,
  identity,
  prefillConsent,
}: {
  /** `passport` saves edits to a completed profile. */
  mode?: "onboarding" | "passport";
  saved: Saved | null;
  languages: { code: string; label: string }[];
  states: string[];
  identity: PanelInitialState;
  prefillConsent: PrefillConsent | null;
}) {
  const [state, action] = useActionState(mode === "passport" ? updateAboutAction : saveAboutAction, initialFormState);
  const e = state.fieldErrors ?? {};
  const chosenLanguages = listValue(state, "languages", saved?.languages);

  const [legalName, setLegalName] = useState(() => textValue(state, "legalName", saved?.legalName));
  const [verifiedName, setVerifiedName] = useState(identity.prefill?.fullName ?? null);
  const [selectedState, setSelectedState] = useState(() => textValue(state, "state", saved?.state));
  const init = initialCity(selectedState, textValue(state, "city", saved?.city));
  const [city, setCity] = useState(() => (state.values?.city !== undefined ? textValue(state, "city", "") : init.city));
  const [cityOther, setCityOther] = useState(() => textValue(state, "cityOther", init.other));
  const [otherLanguages, setOtherLanguages] = useState<string[]>(() =>
    listValue(state, "languagesOther", saved?.languagesOther),
  );
  const [otherDraft, setOtherDraft] = useState("");
  const [showOther, setShowOther] = useState(otherLanguages.length > 0);

  const cities = selectedState ? (CITIES_BY_STATE[selectedState as StateName] ?? []) : [];
  const nameIsVerified = Boolean(verifiedName && legalName && namesMatch(verifiedName, legalName));

  const addOtherLanguage = () => {
    const v = otherDraft.trim().replace(/\s+/g, " ");
    if (!v || otherLanguages.length >= MAX_OTHER_LANGUAGES) return;
    if (!otherLanguages.some((l) => l.toLowerCase() === v.toLowerCase())) setOtherLanguages([...otherLanguages, v]);
    setOtherDraft("");
  };

  return (
    <div className="flex flex-col gap-8">
      <MobileIdentityPanel
        initial={identity}
        consent={prefillConsent}
        onUseName={(name) => {
          setVerifiedName(name);
          setLegalName(name);
        }}
      />

      <form action={action} className="flex flex-col gap-7" noValidate>
        <FormMessage state={state} />
        <FormField
          id="legalName"
          label="Legal name"
          required
          description="As it appears on your PAN. Kept private to CreatorCo."
          errors={e.legalName}
        >
          {(a11y) => (
            <div className="flex flex-col gap-2">
              <Input
                {...a11y}
                name="legalName"
                autoComplete="name"
                required
                maxLength={120}
                value={legalName}
                onChange={(ev) => setLegalName(ev.currentTarget.value)}
              />
              {verifiedName ? (
                <div>
                  <StatusBadge tone={nameIsVerified ? "success" : "warning"}>
                    {nameIsVerified
                      ? "Matches verified name"
                      : "Differs from the verified name — that's OK if intentional"}
                  </StatusBadge>
                </div>
              ) : null}
            </div>
          )}
        </FormField>

        <FormField
          id="displayName"
          label="Display name"
          required
          description="Your creator name."
          errors={e.displayName}
        >
          {(a11y) => (
            <Input
              {...a11y}
              name="displayName"
              autoComplete="nickname"
              required
              maxLength={60}
              defaultValue={textValue(state, "displayName", saved?.displayName)}
            />
          )}
        </FormField>

        <div className="grid gap-7 sm:grid-cols-2">
          <FormField id="state" label="State or union territory" errors={e.state}>
            {(a11y) => (
              <NativeSelect
                {...a11y}
                name="state"
                autoComplete="address-level1"
                value={selectedState}
                onChange={(ev) => {
                  setSelectedState(ev.currentTarget.value);
                  setCity("");
                  setCityOther("");
                }}
              >
                <option value="">Select…</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="city"
            label="City"
            description={selectedState ? undefined : "Choose a state first."}
            errors={e.city}
          >
            {(a11y) => (
              <NativeSelect
                {...a11y}
                name="city"
                autoComplete="address-level2"
                disabled={!selectedState}
                value={city}
                onChange={(ev) => setCity(ev.currentTarget.value)}
              >
                <option value="">Select…</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={OTHER_CITY}>Other…</option>
              </NativeSelect>
            )}
          </FormField>
        </div>
        {city === OTHER_CITY ? (
          <FormField id="cityOther" label="Your city" required errors={e.cityOther}>
            {(a11y) => (
              <Input
                {...a11y}
                name="cityOther"
                autoComplete="address-level2"
                maxLength={80}
                value={cityOther}
                onChange={(ev) => setCityOther(ev.currentTarget.value)}
              />
            )}
          </FormField>
        ) : null}

        <ChoiceFieldset
          id="languages"
          legend="Languages you create in"
          required
          errors={e.languages ?? e.languagesOther}
        >
          <div className="flex flex-wrap gap-2">
            {languages.map((l) => (
              <CheckboxChip
                key={l.code}
                name="languages"
                value={l.code}
                label={l.label}
                defaultChecked={chosenLanguages.includes(l.code)}
              />
            ))}
            {otherLanguages.map((l) => (
              <span
                key={l}
                className="inline-flex items-center gap-1 rounded-full border border-ink bg-ink py-1.5 pr-1.5 pl-3.5 text-sm text-paper"
              >
                <input type="hidden" name="languagesOther" value={l} />
                {l}
                <button
                  type="button"
                  aria-label={`Remove ${l}`}
                  className="flex size-6 items-center justify-center rounded-full hover:bg-paper/15"
                  onClick={() => setOtherLanguages(otherLanguages.filter((x) => x !== l))}
                >
                  ×
                </button>
              </span>
            ))}
            {!showOther ? (
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-dashed border-line-strong px-3.5 py-2 text-sm text-ink-muted hover:border-ink-subtle"
                onClick={() => setShowOther(true)}
              >
                + Other
              </button>
            ) : null}
          </div>
          {showOther ? (
            <div className="flex max-w-md gap-2">
              <Input
                aria-label="Other language"
                placeholder="e.g. Konkani"
                maxLength={40}
                value={otherDraft}
                disabled={otherLanguages.length >= MAX_OTHER_LANGUAGES}
                onChange={(ev) => setOtherDraft(ev.currentTarget.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    addOtherLanguage();
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={addOtherLanguage} disabled={!otherDraft.trim()}>
                Add
              </Button>
            </div>
          ) : null}
        </ChoiceFieldset>

        <FormFooter>
          <SubmitButton size="lg">{mode === "passport" ? "Save changes" : "Save and continue"}</SubmitButton>
        </FormFooter>
      </form>
    </div>
  );
}
