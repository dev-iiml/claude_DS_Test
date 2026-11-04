import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export function SignOutForm({ variant = "ghost" }: { variant?: "ghost" | "secondary" | "destructive" }) {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant={variant} size="sm" className={variant === "ghost" ? "text-ink-muted" : undefined}>
        Sign out
      </Button>
    </form>
  );
}
