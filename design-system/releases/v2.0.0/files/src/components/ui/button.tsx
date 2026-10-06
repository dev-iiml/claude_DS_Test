import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/cn";

/** iOS-style buttons: 50pt filled primary, tinted secondary, plain text; press feedback via scale. */
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold press disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground",
        secondary: "bg-elevated text-ink ring-1 ring-line ring-inset",
        gold: "bg-gold text-paper",
        ghost: "text-ink hover:bg-elevated",
        link: "h-auto px-0 text-gold underline-offset-4 hover:underline",
        destructive: "bg-danger-soft text-danger",
      },
      size: {
        sm: "h-button-sm rounded-full px-4 text-subhead",
        md: "h-control rounded-control px-5 text-body",
        lg: "h-control-lg rounded-lg px-6 text-body",
        icon: "size-touch rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
