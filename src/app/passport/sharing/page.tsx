import Link from "next/link";
import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { CONSENT_KEYS } from "@/modules/consent";
import { isFeatureEnabled } from "@/modules/integrations/change-service";
import { ownerPreviewMaterial } from "@/modules/public-passport/page-service";
import { getSharingState } from "@/modules/public-passport/settings-service";

import { requireMember } from "../../_lib/member";
import { CreatorShell } from "../../_components/creator-shell";
import { pendingConsent } from "../brand-work/_lib";
import { removePhotoAction, unpublishAction } from "./actions";
import { AudienceForm, BioForm, FieldsForm, OptionsForm, PublishForm, SlugForm } from "./forms";

export const metadata: Metadata = { title: "Sharing" };

const NOTICES: Record<string, string> = {
  published: "Your Passport is live. Share the link with anyone you like.",
  unpublished: "Your Passport is offline. The link now shows that the page is gone.",
  link: "Your link was changed. The old link forwards for 30 days.",
  bio: "Your bio was saved.",
  photo: "Your photo was uploaded.",
  photo_removed: "Your photo was removed.",
  fields: "What's shown was saved.",
  options: "Your options were saved.",
  audience: "Who can unlock was saved.",
};

const ERRORS: Record<string, string> = {
  rate_limited: "You've uploaded several photos recently. Please try again later.",
  photo_too_large: "Photos can be up to 3 MB.",
  photo_missing: "Choose a photo to upload.",
  photo_paused: "Photo uploads are paused right now. Please try again later.",
  photo_file_rejected: "Upload a JPEG or PNG that passes our checks.",
  photo_not_eligible: "Complete your profile first.",
  photo_failed: "We couldn't upload that photo.",
};

const one = (q: Record<string, string | string[] | undefined>, k: string) =>
  typeof q[k] === "string" ? (q[k] as string) : undefined;

export default async function SharingPage({ searchParams }: PageProps<"/passport/sharing">) {
  const { user } = await requireMember();
  const db = getDb();
  const q = await searchParams;
  const state = await getSharingState(db, user.userId);
  const p = state.passport;
  const [publicDefinition, unlockDefinition, open, discoveryOn] = await Promise.all([
    pendingConsent(user.userId, CONSENT_KEYS.publicPassport),
    pendingConsent(user.userId, CONSENT_KEYS.passportUnlock),
    ownerPreviewMaterial(db, p),
    isFeatureEnabled(db, "brand_discovery"),
  ]);
  const notice = NOTICES[one(q, "notice") ?? ""];
  const error = ERRORS[one(q, "error") ?? ""];
  const hasPhoto = Boolean(p.photoKey && p.photoScan === "clean");

  return (
    <CreatorShell>
      <BackLink href="/passport" label="Passport" />
      <PageHeader
        title="Sharing"
        description="A public page for your verified creator profile. You choose what everyone sees and what only people you trust can unlock."
      />

      {notice ? (
        <Alert tone="success" className="mb-6">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      ) : null}

      <div className="flex max-w-5xl flex-col gap-10">
        <section aria-labelledby="link-heading" className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <h2 id="link-heading" className="text-title-3 font-semibold tracking-tight">
              Your public link
            </h2>
            {state.published ? (
              <StatusBadge tone="success">Live</StatusBadge>
            ) : (
              <StatusBadge>Not published</StatusBadge>
            )}
          </div>
          {state.published && p.slug ? (
            <div className="flex flex-col gap-5">
              <ListGroup id="live-link" label="Link">
                <ListRow href={`/p/${p.slug}`} label={`/p/${p.slug}`} detail="Opens your page as a stranger sees it" />
              </ListGroup>
              <SlugForm slug={p.slug} />
              <form action={unpublishAction}>
                <Button type="submit" variant="secondary">
                  Take my Passport offline
                </Button>
              </form>
            </div>
          ) : !state.canPublish.feature ? (
            <Alert tone="info">Public passports are paused right now. Your settings are kept.</Alert>
          ) : !state.canPublish.verifiedAccount ? (
            <Alert tone="info">
              Connect and verify at least one social account before you publish — it shows the page is really yours.{" "}
              <Link href="/passport/connect" className="text-gold underline-offset-2 hover:underline">
                Connect an account
              </Link>
            </Alert>
          ) : (
            <PublishForm suggestedSlug={state.suggestedSlug} definition={publicDefinition} />
          )}
          <p className="text-footnote text-ink-muted">
            Your Passport shows verified creator-professional information. It isn&apos;t a credit assessment, and
            nothing on it comes from your financial eligibility.
          </p>
        </section>

        <section id="profile" aria-labelledby="profile-heading" className="flex flex-col gap-4">
          <h2 id="profile-heading" className="text-title-3 font-semibold tracking-tight">
            Photo and bio
          </h2>
          <form
            action="/passport/sharing/photo"
            method="post"
            encType="multipart/form-data"
            className="flex flex-col gap-3"
          >
            <label htmlFor="photo" className="text-subhead font-medium">
              Photo <span className="font-normal text-ink-subtle">JPEG or PNG, up to 3 MB</span>
            </label>
            <input id="photo" name="file" type="file" accept="image/jpeg,image/png" className="text-subhead" required />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="secondary">
                Upload photo
              </Button>
              {hasPhoto ? (
                <Button type="submit" variant="ghost" formAction={removePhotoAction} formNoValidate>
                  Remove photo
                </Button>
              ) : null}
            </div>
          </form>
          <BioForm bio={p.bio} />
        </section>

        <section id="fields" aria-labelledby="fields-heading" className="flex flex-col gap-4">
          <h2 id="fields-heading" className="text-title-3 font-semibold tracking-tight">
            What&apos;s shown
          </h2>
          {open ? (
            <FieldsForm tiers={state.tiers} open={open} hasPhoto={hasPhoto} />
          ) : (
            <Alert tone="info">Your Passport preview isn&apos;t available right now.</Alert>
          )}
        </section>

        <section id="options" aria-labelledby="options-heading" className="flex flex-col gap-4">
          <h2 id="options-heading" className="text-title-3 font-semibold tracking-tight">
            Options
          </h2>
          <OptionsForm indexable={p.indexable} includePrivateInTotals={p.includePrivateInTotals} />
        </section>

        <section id="unlock" aria-labelledby="unlock-heading" className="flex flex-col gap-4">
          <h2 id="unlock-heading" className="text-title-3 font-semibold tracking-tight">
            Who can unlock
          </h2>
          <AudienceForm
            audience={p.audience as "code_holders_only" | "code_holders_and_verified_brands"}
            discoverable={p.discoverable}
            definition={unlockDefinition}
            discoveryOn={discoveryOn}
          />
          <ListGroup id="unlock-links" label="Access">
            <ListRow
              href="/passport/sharing/codes"
              label="Access codes"
              detail={state.consents.passportUnlock ? "Create, see and revoke codes" : "Save who can unlock first"}
            />
            <ListRow href="/passport/sharing/log" label="Access log" detail="Who unlocked your Passport, and when" />
          </ListGroup>
        </section>
      </div>
    </CreatorShell>
  );
}
