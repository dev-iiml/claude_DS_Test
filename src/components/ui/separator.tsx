import * as React from "react";

import { cn } from "@/lib/cn";

export function Separator({ className, ...props }: React.ComponentProps<"hr">) {
  return <hr className={cn("border-0 border-t border-line", className)} {...props} />;
}
