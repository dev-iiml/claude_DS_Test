import Link from "next/link";
import type { Metadata } from "next";

import { AuthShell } from "@/components/creatorco";

import { redirectIfSignedIn } from "../../(auth)/redirect-if-signed-in";
import { BrandEmailForm } from "../forms";

export const metadata: Metadata = { title: "Brands and agencies" };

/** Public: brand and agency sign-up, step 1 (work email). */
export default async function BrandSignUpPage() {
  await redirectIfSignedIn();
  return (
    <AuthShell
      title="CreatorCo for brands"
      description="Verified brands and agencies can unlock the Passport details creators choose to share with them."
    >
      <BrandEmailForm />
      <p className="mt-6 text-footnote text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-gold underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
