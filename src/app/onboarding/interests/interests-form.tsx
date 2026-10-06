"use client";

import { useActionState, useState } from "react";

import { CheckboxChip, ChoiceFieldset, FormFooter, FormMessage, SwitchRow } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { initialFormState } from "@/lib/forms";

import { updateInterestsAction } from "@/app/passport/actions";

import { saveInterestsAction } from "../actions";
import { boolValue, listValue } from "../_lib/form-values";

interface Saved {
  prInterest: boolean;
  preferredCategories: string[];
  brandInterests: string[];
  travelInterest: boolean;
}

export function InterestsForm({
  mode = "onboarding",
  categories,
  saved,
}: {
  /** `passport` saves edits to a completed profile. */
  mode?: "onboarding" | "passport";
  categories: { code: string; label: string }[];
  saved: Saved | null;
}) {
  const [state, action] = useActionState(
    mode === "passport" ? updateInterestsAction : saveInterestsAction,
    initialFormState,
  );
  const e = state.fieldErrors ?? {};
  const [pr, setPr] = useState(() => boolValue(state, "prInterest", saved?.prInterest));
  const prCategories = listValue(state, "preferredCategories", saved?.preferredCategories);
  const brands = listValue(state, "brandInterests", saved?.brandInterests);

  return (
    <form action={action} className="flex flex-col gap-9" noValidate>
      <FormMessage state={state} />

      <ChoiceFieldset id="pr" legend="PR and product seeding" errors={e.prInterest}>
        <div className="rounded-lg bg-surface px-4 ring-1 ring-line ring-inset">
          <SwitchRow
            name="prInterest"
            label="Receive PR packages"
            description="Brands may send you products. No obligation to post."
            checked={pr}
            onChange={(ev) => setPr(ev.currentTarget.checked)}
          />
        </div>
        {pr ? (
          <ChoiceFieldset id="preferredCategories" legend="PR categories" errors={e.preferredCategories}>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <CheckboxChip
                  key={c.code}
                  name="preferredCategories"
                  value={c.code}
                  label={c.label}
                  defaultChecked={prCategories.includes(c.code)}
                />
              ))}
            </div>
          </ChoiceFieldset>
        ) : null}
      </ChoiceFieldset>

      <ChoiceFieldset id="brandInterests" legend="Brand categories you'd like to work with" errors={e.brandInterests}>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <CheckboxChip
              key={c.code}
              name="brandInterests"
              value={c.code}
              label={c.label}
              defaultChecked={brands.includes(c.code)}
            />
          ))}
        </div>
      </ChoiceFieldset>

      <ChoiceFieldset id="travel" legend="Travel and events" errors={e.travelInterest}>
        <div className="rounded-lg bg-surface px-4 ring-1 ring-line ring-inset">
          <SwitchRow
            name="travelInterest"
            label="Travel and event invitations"
            description="Launches, creator weekends and hosted experiences."
            defaultChecked={boolValue(state, "travelInterest", saved?.travelInterest)}
          />
        </div>
      </ChoiceFieldset>

      <FormFooter>
        <SubmitButton size="lg">{mode === "passport" ? "Save changes" : "Save and continue"}</SubmitButton>
      </FormFooter>
    </form>
  );
}
