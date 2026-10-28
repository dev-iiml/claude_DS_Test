import type { Metadata } from "next";

import { AuthShell } from "@/components/creatorco";

import { recordAfterResponse } from "../../_lib/analytics";
import { redirectIfSignedIn } from "../redirect-if-signed-in";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Apply" };

export default async function SignUpPage() {
  await redirectIfSignedIn();
  // Anonymous funnel count: no identifier, no cookie.
  recordAfterResponse({ event: "application_started" });
  return (
    <AuthShell
      title="Apply for membership"
      description="Create your account to begin your Creator Professional Profile. It takes about five minutes."
    >
      <SignUpForm />
    </AuthShell>
  );
}
