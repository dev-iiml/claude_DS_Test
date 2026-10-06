import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know the design-token utility names (see globals.css),
 * otherwise `text-body` is mistaken for a text colour and dropped when merged
 * with `text-ink`, and `rounded-control` never overrides another radius.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "large-title",
        "title-1",
        "title-2",
        "title-3",
        "headline",
        "body",
        "callout",
        "subhead",
        "footnote",
        "caption",
        "caption-2",
      ],
      radius: ["control", "card", "pill"],
      shadow: ["membership-card", "thumb", "overlay"],
      spacing: [
        "button-sm",
        "control",
        "control-lg",
        "row",
        "choice-row",
        "chip",
        "segment",
        "switch-w",
        "switch-h",
        "switch-thumb",
        "indicator",
        "top-bar",
        "tab-bar",
        "sidebar",
        "membership-card",
        "touch",
      ],
    },
  },
});

/** Merges Tailwind class names (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
