"use client";

import { useState, useTransition } from "react";

import { SegmentedControl } from "@/components/creatorco/choices";
import type { Appearance } from "@/design/tokens";

import { setAppearanceAction } from "../_actions/appearance";

/** Dark / Light / System, applied instantly and remembered on this device. */
export function AppearanceControl({ initial }: { initial: Appearance }) {
  const [value, setValue] = useState<Appearance>(initial);
  const [, startTransition] = useTransition();
  return (
    <SegmentedControl
      name="appearance"
      legend="Appearance"
      value={value}
      options={[
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
        { value: "system", label: "System" },
      ]}
      onChange={(v) => {
        const next = v as Appearance;
        setValue(next);
        document.documentElement.dataset.theme = next;
        startTransition(() => setAppearanceAction(next));
      }}
    />
  );
}
