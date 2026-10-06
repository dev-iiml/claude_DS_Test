import { redirect } from "next/navigation";

import { resumePath } from "./_lib/context";

export default async function OnboardingIndex() {
  redirect(await resumePath());
}
