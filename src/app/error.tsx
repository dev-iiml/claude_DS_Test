"use client";

import { PageHeading, Lede, Wordmark } from "@/components/creatorco";
import { Button } from "@/components/ui/button";

/** Route-level error boundary. Never renders error details to the user. */
export default function ErrorPage({
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset: () => void;
}) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-5">
      <Wordmark />
      <PageHeading className="mt-8">Something went wrong</PageHeading>
      <Lede>We couldn&rsquo;t complete that just now. Your progress is saved — please try again.</Lede>
      <div className="mt-4">
        <Button onClick={retry ?? reset}>Try again</Button>
      </div>
    </main>
  );
}
