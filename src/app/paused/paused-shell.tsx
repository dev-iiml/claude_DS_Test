import { ComplianceNote, Wordmark } from "@/components/creatorco";

import { SignOutForm } from "../_components/sign-out-form";

/** Minimal frame while membership is paused: no tabs, just the way back. */
export function PausedShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bar-blur pt-safe">
        <div className="mx-auto flex h-12 w-full max-w-2xl items-center justify-between px-[max(1rem,env(safe-area-inset-left))]">
          <Wordmark href="/paused" className="text-[19px]" />
          <SignOutForm />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 pt-5 pb-10 sm:px-6 sm:pt-8">
        {children}
        <ComplianceNote className="mt-12" />
      </main>
    </div>
  );
}
