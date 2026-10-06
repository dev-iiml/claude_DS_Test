import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/cn";

const alertVariants = cva("relative w-full rounded-control px-4 py-3 text-subhead [&_a]:underline", {
  variants: {
    tone: {
      info: "bg-info-soft text-info",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      danger: "bg-danger-soft text-danger",
      neutral: "bg-elevated text-ink-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface AlertProps extends React.ComponentProps<"div">, VariantProps<typeof alertVariants> {
  title?: string;
}

/** Errors are announced assertively (role="alert"); everything else politely (role="status"). */
export function Alert({ className, tone, title, children, role, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && "mt-1", "leading-snug")}>{children}</div> : null}
    </div>
  );
}
