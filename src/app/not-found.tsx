import Link from "next/link";

import { PageHeading, Lede, Wordmark } from "@/components/creatorco";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-5">
      <Wordmark />
      <PageHeading className="mt-8">This page isn&rsquo;t available</PageHeading>
      <Lede>The page may have moved, or you may not have access to it.</Lede>
      <div className="mt-4">
        <Button asChild variant="secondary">
          <Link href="/">Return home</Link>
        </Button>
      </div>
    </main>
  );
}
