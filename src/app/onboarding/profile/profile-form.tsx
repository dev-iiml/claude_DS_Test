"use client";

import { useActionState, useState } from "react";

import { CheckboxChip, ChoiceFieldset, FormField, FormFooter, FormMessage, RadioRow } from "@/components/creatorco";
import { SubmitButton } from "@/components/creatorco/submit-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { initialFormState } from "@/lib/forms";
import { MAX_CATEGORIES } from "@/modules/creator-profile/domain";

import { updateProfileAction } from "@/app/passport/actions";

import { saveProfileAction } from "../actions";
import { listValue, textValue } from "../_lib/form-values";

interface Option {
  code: string;
  label: string;
}

interface Saved {
  primaryCreatorHandle: string | null;
  creatorCategory: string | null;
  additionalCategories: string[];
  creatorSince: string | null;
  /** platform code → handle */
  platforms: Record<string, string>;
}

export function ProfileForm({
  mode = "onboarding",
  categories,
  platforms,
  saved,
  maxMonth,
}: {
  /** `passport` saves edits to a completed profile. */
  mode?: "onboarding" | "passport";
  categories: Option[];
  platforms: Option[];
  saved: Saved;
  maxMonth: string;
}) {
  const [state, action] = useActionState(
    mode === "passport" ? updateProfileAction : saveProfileAction,
    initialFormState,
  );
  const e = state.fieldErrors ?? {};
  const [selected, setSelected] = useState<string[]>(() => listValue(state, "platforms", Object.keys(saved.platforms)));

  const [chosenCategories, setChosenCategories] = useState<string[]>(() =>
    listValue(state, "categories", saved.creatorCategory ? [saved.creatorCategory, ...saved.additionalCategories] : []),
  );
  const [primaryChoice, setPrimary] = useState(() => textValue(state, "primaryCategory", saved.creatorCategory));
  const primary = chosenCategories.includes(primaryChoice) ? primaryChoice : (chosenCategories[0] ?? "");
  const labelFor = (code: string) => categories.find((c) => c.code === code)?.label ?? code;
  const toggleCategory = (code: string, on: boolean) =>
    setChosenCategories((cur) =>
      on ? (cur.length >= MAX_CATEGORIES ? cur : [...new Set([...cur, code])]) : cur.filter((c) => c !== code),
    );

  const toggle = (code: string, on: boolean) =>
    setSelected((cur) => (on ? [...new Set([...cur, code])] : cur.filter((c) => c !== code)));

  return (
    <form action={action} className="flex flex-col gap-7" noValidate>
      <FormMessage state={state} />
      <FormField
        id="primaryCreatorHandle"
        label="Primary creator handle"
        required
        description="The handle you're best known by, without the @."
        errors={e.primaryCreatorHandle}
      >
        {(a11y) => (
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-subtle"
            >
              @
            </span>
            <Input
              {...a11y}
              name="primaryCreatorHandle"
              className="pl-8"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={65}
              defaultValue={textValue(state, "primaryCreatorHandle", saved.primaryCreatorHandle)}
            />
          </div>
        )}
      </FormField>

      <ChoiceFieldset
        id="categories"
        legend="Categories"
        required
        description={`Choose up to ${MAX_CATEGORIES}, then mark your main one.`}
        errors={e.categories ?? e.primaryCategory}
      >
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = chosenCategories.includes(c.code);
            return (
              <CheckboxChip
                key={c.code}
                name="categories"
                value={c.code}
                label={c.label}
                checked={on}
                disabled={!on && chosenCategories.length >= MAX_CATEGORIES}
                onChange={(ev) => toggleCategory(c.code, ev.currentTarget.checked)}
              />
            );
          })}
        </div>
        {chosenCategories.length > 1 ? (
          <fieldset className="flex flex-col gap-2" aria-describedby="primary-hint">
            <legend className="mb-1 text-sm font-medium">Main category</legend>
            <p id="primary-hint" className="text-sm text-ink-muted">
              Brands and programmes will see this first.
            </p>
            <div className="flex flex-wrap gap-2">
              {chosenCategories.map((code) => (
                <RadioRow
                  key={code}
                  name="primaryCategory"
                  value={code}
                  label={labelFor(code)}
                  checked={primary === code}
                  onChange={() => setPrimary(code)}
                  className="py-2"
                />
              ))}
            </div>
          </fieldset>
        ) : chosenCategories.length === 1 ? (
          <input type="hidden" name="primaryCategory" value={chosenCategories[0]} />
        ) : null}
      </ChoiceFieldset>

      <FormField
        id="creatorSince"
        label="Creating professionally since"
        description="Month and year."
        errors={e.creatorSince}
        className="sm:max-w-xs"
      >
        {(a11y) => (
          <Input
            {...a11y}
            name="creatorSince"
            type="month"
            min="2000-01"
            max={maxMonth}
            placeholder="YYYY-MM"
            defaultValue={textValue(state, "creatorSince", saved.creatorSince)}
          />
        )}
      </FormField>

      <ChoiceFieldset
        id="platforms"
        legend="Platforms you create on"
        required
        description="Select each platform and confirm your handle there."
        errors={e.platforms}
      >
        <ul className="flex flex-col gap-2">
          {platforms.map((p) => {
            const checked = selected.includes(p.code);
            const handleId = `handle_${p.code}`;
            return (
              <li
                key={p.code}
                className={cn(
                  "rounded-control border bg-surface transition-colors",
                  checked ? "border-ink" : "border-line-strong",
                )}
              >
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
                  <input
                    type="checkbox"
                    name="platforms"
                    value={p.code}
                    checked={checked}
                    onChange={(ev) => toggle(p.code, ev.currentTarget.checked)}
                    className="size-4 accent-[var(--ink)] focus-visible:outline-none"
                  />
                  <span className="text-subhead font-medium">{p.label}</span>
                </label>
                {checked ? (
                  <div className="px-4 pb-4">
                    <FormField
                      id={handleId}
                      label={`${p.label} handle`}
                      optionalLabel={false}
                      description="Leave blank if it's the same as your primary handle."
                      errors={e[handleId]}
                    >
                      {(a11y) => (
                        <Input
                          {...a11y}
                          name={handleId}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          maxLength={65}
                          defaultValue={textValue(state, handleId, saved.platforms[p.code])}
                        />
                      )}
                    </FormField>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </ChoiceFieldset>

      <FormFooter>
        <SubmitButton size="lg">{mode === "passport" ? "Save changes" : "Save and continue"}</SubmitButton>
      </FormFooter>
    </form>
  );
}
