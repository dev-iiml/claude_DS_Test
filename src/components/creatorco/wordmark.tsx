import Link from "next/link";

import { cn } from "@/lib/cn";

export function Wordmark({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-baseline gap-1 font-serif text-[22px] leading-none tracking-tight", className)}
      aria-label="CreatorCo home"
    >
      <span>CreatorCo</span>
      <span aria-hidden="true" className="size-1.5 translate-y-[-0.12rem] rounded-full bg-gold" />
    </Link>
  );
}
