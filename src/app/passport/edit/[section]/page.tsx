import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink, PageHeader } from "@/components/creatorco";
import { getDb } from "@/db";
import { getOnboardingState } from "@/modules/creator-profile/queries";

import { requireMember } from "@/app/_lib/member";
import { CreatorShell } from "@/app/_components/creator-shell";
import { AboutForm } from "@/app/onboarding/about/about-form";
import { BusinessForm } from "@/app/onboarding/business/business-form";
import { InterestsForm } from "@/app/onboarding/interests/interests-form";
import { ProfileForm } from "@/app/onboarding/profile/profile-form";
import {
  aboutFormProps,
  businessFormProps,
  interestsFormProps,
  profileFormProps,
} from "@/app/onboarding/_lib/form-props";

const SECTIONS = {
  about: { title: "About you", description: "Your legal name stays private. Your display name is how you appear." },
  profile: { title: "Creator profile", description: "What you create and where you publish." },
  business: { title: "Business", description: "Legal form and GST registration are separate — keep both current." },
  interests: { title: "Interests", description: "Shapes the programmes and access we show you." },
} as const;
type Section = keyof typeof SECTIONS;

const isSection = (s: string): s is Section => Object.hasOwn(SECTIONS, s);

export async function generateMetadata({ params }: PageProps<"/passport/edit/[section]">): Promise<Metadata> {
  const { section } = await params;
  return { title: isSection(section) ? `Edit ${SECTIONS[section].title.toLowerCase()}` : "Passport" };
}

/** Passport editing: the onboarding forms in `passport` mode. */
export default async function EditSectionPage({ params }: PageProps<"/passport/edit/[section]">) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  const { user } = await requireMember();
  const db = getDb();
  const state = await getOnboardingState(db, user.userId);

  let form: React.ReactNode;
  switch (section) {
    case "about":
      form = <AboutForm mode="passport" {...await aboutFormProps(db, user.userId, state)} />;
      break;
    case "profile":
      form = <ProfileForm mode="passport" {...await profileFormProps(db, state)} />;
      break;
    case "business":
      form = <BusinessForm mode="passport" {...await businessFormProps(db, user.userId, state)} />;
      break;
    case "interests":
      form = <InterestsForm mode="passport" {...await interestsFormProps(db, state)} />;
      break;
  }

  return (
    <CreatorShell>
      <BackLink href="/passport" label="Passport" />
      <PageHeader title={SECTIONS[section].title} description={SECTIONS[section].description} />
      <div className="max-w-2xl">{form}</div>
    </CreatorShell>
  );
}
