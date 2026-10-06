/**
 * CreatorCo design-system specimens — rendered from the REAL components in src/components
 * (bundled with esbuild; next/link and next/navigation are shimmed). Sample data mirrors the
 * demo seed. Proposed specimens are labelled PROPOSED and are not part of the product.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  Lock,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AppShell,
  AuthShell,
  BackLink,
  CheckboxChip,
  CheckboxRow,
  ChoiceFieldset,
  ComplianceNote,
  ConsentText,
  CreatorStatusBadge,
  DisplayHeading,
  EmptyState,
  Eyebrow,
  FieldError,
  FormField,
  FormFooter,
  FormMessage,
  GroupLabel,
  Lede,
  ListGroup,
  ListRow,
  MembershipCard,
  MetricBlock,
  OnboardingShell,
  PageHeader,
  PageHeading,
  ProgressMeter,
  ProgressSteps,
  RadioRow,
  SectionHeading,
  SegmentedControl,
  StatusBadge,
  SwitchRow,
  VerificationMark,
  Wordmark,
} from "@/components/creatorco";
import { Sidebar, TabBar, type NavItem } from "@/components/creatorco/app-nav";
import { RequirementChecklist } from "@/components/creatorco/password-checklist";
import { SubmitButton } from "@/components/creatorco/submit-button";

/* ---------- sample data (mirrors the demo seed) ---------- */

const CREATOR_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/passport", label: "Passport", icon: "passport" },
  { href: "/access", label: "Access", icon: "access" },
  { href: "/account", label: "Account", icon: "account" },
];
const CARD = {
  displayName: "Aarohi Makes",
  handle: "aarohi.makes.demo",
  memberSince: "September 2026",
  memberNumber: "CC 0000 0001",
};
const CREATOR_PROFILE_CONSENT = {
  id: "creator-profile-v1",
  title: "Creator Profile",
  version: 1,
  purpose: "To create and maintain your CreatorCo Creator Professional Profile and show it to you inside CreatorCo.",
  body: "CreatorCo will store the details you gave during onboarding — your legal and display names, location, languages, creator categories, platforms you use, business status and professional interests.\n\nYou can review and edit them on your Passport at any time.",
};
const PASSWORD_RULES = [
  { key: "length", label: "At least 8 characters", met: true },
  { key: "lower", label: "A lower-case letter", met: true },
  { key: "upper", label: "An upper-case letter", met: false },
  { key: "digit", label: "A number", met: true },
  { key: "special", label: "A special character (e.g. ! @ # -)", met: false },
];
const STEPS = [
  { key: "welcome", label: "Welcome" },
  { key: "about", label: "About you" },
  { key: "profile", label: "Creator profile" },
  { key: "business", label: "Business status" },
  { key: "interests", label: "Professional interests" },
  { key: "consent", label: "Creator Profile consent" },
] as const;

/* ---------- specimen scaffolding (token classes only) ---------- */

function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={"min-h-full bg-paper p-5 text-ink " + (className ?? "")}>{children}</div>;
}
function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="mb-6 last:mb-0">
      <p className="mb-2.5 font-mono text-caption-2 tracking-[0.08em] text-ink-subtle uppercase">{label}</p>
      <div className={"flex flex-wrap items-start gap-3 " + (className ?? "")}>{children}</div>
    </div>
  );
}
function Proposed({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-2 rounded-control bg-warning-soft px-4 py-3 text-subhead text-warning">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <b className="font-semibold">Proposed — not adopted.</b> {children}
      </span>
    </div>
  );
}
function PendingSubmit({ label, pending }: { label: string; pending: string }) {
  const ref = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    ref.current?.requestSubmit();
  }, []);
  return (
    <form ref={ref} action={() => new Promise<void>(() => {})}>
      <SubmitButton pendingLabel={pending}>{label}</SubmitButton>
    </form>
  );
}
const W = ({ w, children }: { w: number; children: React.ReactNode }) => <div style={{ width: w }}>{children}</div>;

/* ---------- component specimens ---------- */

const S: Record<string, () => React.ReactNode> = {
  Button: () => (
    <Page>
      <Row label="Variants · md (50px, rounded-control)">
        <Button>Apply for membership</Button>
        <Button variant="secondary">I&rsquo;m a member</Button>
        <Button variant="ghost">Sign out</Button>
        <Button variant="link">Read what this means</Button>
        <Button variant="destructive">Disconnect</Button>
        <Button variant="gold">Gold (reserved)</Button>
      </Row>
      <Row label="Sizes">
        <Button size="sm">Small · 36px</Button>
        <Button size="md">Medium · 50px</Button>
        <Button size="lg">Large · 54px</Button>
        <Button size="icon" variant="secondary" aria-label="Close">
          <X />
        </Button>
      </Row>
      <Row label="States">
        <Button disabled>Disabled</Button>
        <PendingSubmit label="Save and continue" pending="Saving…" />
        <Button variant="secondary" size="sm">
          Connect
        </Button>
      </Row>
    </Page>
  ),

  Badge: () => (
    <Page>
      <Row label="StatusBadge tones">
        <StatusBadge>Not yet supported</StatusBadge>
        <StatusBadge tone="brand">Preview</StatusBadge>
        <StatusBadge tone="success">Connected</StatusBadge>
        <StatusBadge tone="warning">Needs attention</StatusBadge>
        <StatusBadge tone="danger">down</StatusBadge>
        <StatusBadge tone="info">Coming soon</StatusBadge>
        <Badge tone="ink">ink</Badge>
      </Row>
      <Row label="CreatorStatusBadge · Member → Onyx → Icon">
        <CreatorStatusBadge tier="member" />
        <CreatorStatusBadge tier="onyx" />
        <CreatorStatusBadge tier="icon" />
      </Row>
      <Row label="Signal provenance (Professional signals page)">
        <StatusBadge tone="success">Verified</StatusBadge>
        <StatusBadge>Self-declared</StatusBadge>
        <StatusBadge tone="info">Derived</StatusBadge>
        <StatusBadge>High confidence</StatusBadge>
      </Row>
    </Page>
  ),

  Alert: () => (
    <Page className="flex max-w-xl flex-col gap-3">
      <Alert tone="success">Account connected. Your creator activity is now verified.</Alert>
      <Alert tone="info" title="Coming in the next build">
        Any eligibility shown will be a CreatorCo recommendation, subject to partner-lender approval.
      </Alert>
      <Alert tone="warning">Your connection to Instagram expired. Reconnect to keep signals up to date.</Alert>
      <FormMessage state={{ status: "error", message: "Please check the highlighted fields." }} />
      <Alert tone="neutral">Account disconnected.</Alert>
    </Page>
  ),

  Card: () => (
    <Page className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Creator Status</CardTitle>
            <CreatorStatusBadge tier="member" />
          </div>
          <CardDescription>Your professional standing in the network.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-subhead text-ink-muted">
            Status reflects your creator career and participation. It never sets financial limits.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Financial eligibility</CardTitle>
            <StatusBadge tone="info">Coming soon</StatusBadge>
          </div>
          <CardDescription>Optional, with its own separate consent.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-subhead text-ink-muted">
            Any eligibility shown will be a CreatorCo recommendation, subject to partner-lender approval.
          </p>
        </CardContent>
      </Card>
      <Card className="sm:col-span-2">
        <CardContent>
          <ConsentText id="c1" definition={CREATOR_PROFILE_CONSENT} />
        </CardContent>
        <CardFooter className="flex-col items-stretch">
          <CheckboxRow name="agree" label="I agree to CreatorCo using my details for my Creator Professional Profile" />
        </CardFooter>
      </Card>
    </Page>
  ),

  Input: () => (
    <Page className="flex max-w-md flex-col gap-6">
      <FormField id="d" label="Display name" required description="How you appear across the network.">
        {(a) => <Input {...a} placeholder="e.g. Aarohi Makes" />}
      </FormField>
      <FormField id="f" label="Primary creator handle" required>
        {(a) => <Input {...a} defaultValue="@aarohi.makes.demo" />}
      </FormField>
      <FormField id="e" label="Legal name" required errors={["Enter your full legal name."]}>
        {(a) => <Input {...a} />}
      </FormField>
      <FormField id="x" label="PAN-linked name">
        {(a) => <Input {...a} defaultValue="Fetched after verification" disabled />}
      </FormField>
    </Page>
  ),

  Select: () => (
    <Page className="flex max-w-md flex-col gap-6">
      <FormField id="s1" label="State or union territory">
        {(a) => (
          <NativeSelect {...a} defaultValue="">
            <option value="">Select…</option>
            <option>Maharashtra</option>
          </NativeSelect>
        )}
      </FormField>
      <FormField id="s2" label="City" description="Choose a state first.">
        {(a) => (
          <NativeSelect {...a} disabled>
            <option>Select…</option>
          </NativeSelect>
        )}
      </FormField>
      <FormField id="s3" label="Main category" required errors={["Choose your main category."]}>
        {(a) => (
          <NativeSelect {...a}>
            <option>Select…</option>
          </NativeSelect>
        )}
      </FormField>
    </Page>
  ),

  FormField: () => (
    <Page className="flex max-w-md flex-col gap-7">
      <FormField
        id="ff1"
        label="Legal name"
        required
        description="As it appears on your PAN. Kept private to CreatorCo."
      >
        {(a) => <Input {...a} />}
      </FormField>
      <FormField id="ff2" label="Website" description="Shown on your Passport.">
        {(a) => <Input {...a} placeholder="https://" />}
      </FormField>
      <ChoiceFieldset id="lf" legend="Legal form" required errors={["Choose your legal form."]}>
        <RadioRow
          name="lf"
          value="i"
          label="Individual creator"
          description="You create and earn in your personal capacity."
        />
        <RadioRow
          name="lf"
          value="p"
          label="Partnership firm"
          description="Not supported in the current pilot."
          disabled
        />
      </ChoiceFieldset>
      <FieldError id="fe" errors={["FieldError renders the first message only."]} />
    </Page>
  ),

  LabelSeparator: () => (
    <Page className="flex max-w-md flex-col gap-4">
      <Label htmlFor="n">Label · 15px medium</Label>
      <Input id="n" placeholder="Paired control" />
      <Separator />
      <p className="text-footnote text-ink-muted">Separator: a 1px `line` hairline.</p>
    </Page>
  ),

  Skeleton: () => (
    <Page>
      <div role="status" aria-label="Loading" className="max-w-2xl">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-9 w-64" />
        <Skeleton className="mt-6 aspect-[1.586/1] w-full max-w-membership-card rounded-xl" />
        <div className="mt-6 flex flex-col gap-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>
    </Page>
  ),

  Headings: () => (
    <Page className="flex flex-col gap-5">
      <div>
        <Eyebrow>Membership by application · India</Eyebrow>
        <DisplayHeading className="mt-3 max-w-2xl">
          Your influence opens doors.
          <span className="block text-gold">Your business earns the limit.</span>
        </DisplayHeading>
      </div>
      <Separator />
      <div>
        <Eyebrow className="mb-1">Welcome back</Eyebrow>
        <PageHeading>Aarohi Makes</PageHeading>
        <Lede className="mt-2">Your verified creator-professional identity.</Lede>
      </div>
      <SectionHeading>Access</SectionHeading>
      <GroupLabel className="px-0">Professional signals</GroupLabel>
    </Page>
  ),

  Choices: () => (
    <Page className="flex max-w-lg flex-col gap-6">
      <ChoiceFieldset id="gst" legend="GST registration" required>
        <RadioRow name="gst" value="n" label="Not registered for GST" defaultChecked />
        <RadioRow name="gst" value="r" label="Registered for GST" />
        <RadioRow name="gst" value="x" label="Not sure" description="We'll ask a reviewer to check." />
      </ChoiceFieldset>
      <CheckboxRow name="a" label="I agree to connect this account for my Creator Passport" defaultChecked />
      <ChoiceFieldset id="lang" legend="Languages you create in" required>
        <div className="flex flex-wrap gap-2">
          <CheckboxChip name="l" value="en" label="English" defaultChecked />
          <CheckboxChip name="l" value="hi" label="Hindi" defaultChecked />
          <CheckboxChip name="l" value="mr" label="Marathi" />
          <CheckboxChip name="l" value="ta" label="Tamil" />
          <CheckboxChip name="l" value="x" label="Food" disabled />
        </div>
      </ChoiceFieldset>
    </Page>
  ),

  SwitchRow: () => (
    <Page className="max-w-lg">
      <Card>
        <CardContent className="flex flex-col divide-y divide-line py-2">
          <SwitchRow
            name="pr"
            label="Open to PR packages"
            description="Brands can send you products to review."
            defaultChecked
          />
          <SwitchRow name="tr" label="Travel and event invitations" />
          <SwitchRow
            name="sg"
            label="Also turn on professional signals"
            description="Optional and separate."
            disabled
          />
        </CardContent>
      </Card>
    </Page>
  ),

  SegmentedControl: () => (
    <Page className="flex max-w-sm flex-col gap-4">
      <div className="rounded-lg bg-surface p-3 ring-1 ring-line ring-inset">
        <SegmentedControl
          name="appearance"
          legend="Appearance"
          defaultValue="dark"
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
        />
      </div>
      <p className="px-4 text-footnote text-ink-subtle">
        Dark is CreatorCo&rsquo;s signature look. System follows your device.
      </p>
    </Page>
  ),

  Progress: () => (
    <Page className="flex max-w-lg flex-col gap-8">
      <ProgressSteps steps={STEPS} currentKey="welcome" />
      <ProgressSteps steps={STEPS} currentKey="business" />
      <ProgressSteps steps={STEPS} currentKey="consent" />
      <div className="flex flex-col gap-3">
        {[0, 80, 100].map((v) => (
          <div key={v} className="flex items-center gap-4">
            <ProgressMeter value={v} label="Passport completion" className="flex-1" />
            <span className="w-24 text-footnote text-ink-muted tabular-nums">{v}% complete</span>
          </div>
        ))}
      </div>
    </Page>
  ),

  RequirementChecklist: () => (
    <Page className="max-w-md">
      <FormField id="pw" label="Password" required>
        {(a) => <Input {...a} type="password" defaultValue="creatorco1" />}
      </FormField>
      <RequirementChecklist id="rules" items={PASSWORD_RULES} className="mt-3" />
    </Page>
  ),

  MetricBlock: () => (
    <Page className="grid max-w-3xl grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        { label: "Creator accounts", value: 128 },
        { label: "Profiles completed", value: 96, hint: "75% of accounts" },
        { label: "Connected accounts", value: 41 },
        { label: "Graph runs", value: 0, hint: "None yet" },
      ].map((m) => (
        <Card key={m.label}>
          <CardContent className="p-4">
            <MetricBlock label={m.label} value={m.value} hint={m.hint} />
          </CardContent>
        </Card>
      ))}
    </Page>
  ),

  EmptyState: () => (
    <Page className="flex max-w-lg flex-col gap-3">
      <EmptyState title="No signals yet" description="Connect an account and we'll compute your first signals." />
      <EmptyState
        title="Nothing to connect"
        description="All supported platforms on your Passport are already connected."
      />
      <EmptyState
        title="Not available yet"
        description="Professional signals aren't available right now."
        action={
          <Button size="sm" variant="secondary">
            Back to Passport
          </Button>
        }
      />
    </Page>
  ),

  SubmitButton: () => (
    <Page>
      <Row label="Idle">
        <form action={() => {}}>
          <SubmitButton size="lg">Complete profile</SubmitButton>
        </form>
      </Row>
      <Row label="Pending (useFormStatus) — disabled, spinner, pending label">
        <PendingSubmit label="Complete profile" pending="Completing your profile…" />
      </Row>
    </Page>
  ),

  Wordmark: () => (
    <Page>
      <Row label="Default · 22px Newsreader + gold dot">
        <Wordmark />
      </Row>
      <Row label="In bars · 19px">
        <Wordmark className="text-[19px]" />
      </Row>
      <Row label="On the membership card">
        <span className="font-serif text-[19px] tracking-tight">
          CreatorCo<span className="text-gold">.</span>
        </span>
      </Row>
      <p className="mt-4 max-w-md text-footnote text-ink-muted">
        &ldquo;CreatorCo&rdquo; is a working-name placeholder. Replace it in <code>wordmark.tsx</code>, the membership
        card and metadata only.
      </p>
    </Page>
  ),

  ListGroup: () => (
    <Page className="flex max-w-xl flex-col gap-8">
      <ListGroup
        id="acc"
        label="Social accounts"
        action={<button className="text-subhead text-gold">Refresh</button>}
        footer="Connecting reads your public profile metrics with your permission. CreatorCo never posts for you."
      >
        <ListRow
          href="#"
          label="Instagram"
          detail="@aarohi.makes.demo"
          accessory={<StatusBadge tone="success">Connected</StatusBadge>}
        />
        <ListRow
          label="YouTube"
          detail="@aarohi.makes.demo · self-declared"
          accessory={
            <Button size="sm" variant="secondary">
              Connect
            </Button>
          }
        />
        <ListRow
          label="Moj"
          detail="@aarohi.makes.demo · self-declared"
          accessory={<StatusBadge>Not yet supported</StatusBadge>}
        />
        <ListRow href="#" label={<span className="text-gold">Connect another account</span>} />
      </ListGroup>
      <ListGroup id="sig" label="Professional signals" footer="About your creator business — not a credit score.">
        <ListRow label="Creating for" value="3 yr 8 mo" />
        <ListRow label="Combined audience" value="46.7K" />
        <ListRow label="Engagement" value="4.3%" />
      </ListGroup>
      <ListGroup id="empty" label="Consents">
        <ListRow label="No consents recorded" />
      </ListGroup>
    </Page>
  ),

  MembershipCard: () => (
    <Page className="flex flex-wrap gap-6">
      <MembershipCard {...CARD} tier="member" className="w-[360px]" />
      <MembershipCard {...CARD} tier="onyx" className="w-[360px]" />
      <MembershipCard {...CARD} tier="icon" className="w-[360px]" />
    </Page>
  ),

  VerificationMark: () => (
    <Page className="max-w-xl">
      <ListGroup id="ver" label="Verification">
        <ListRow leading={<VerificationMark state="missing" />} label="Mobile number" detail="Not verified yet" />
        <ListRow leading={<VerificationMark state="declared" />} label="Legal name" detail="Self-declared" />
        <ListRow leading={<VerificationMark state="attention" />} label="GST registration" detail="Requires review" />
        <ListRow
          leading={<VerificationMark state="verified" />}
          label="Creator activity"
          detail="1 connected account"
        />
      </ListGroup>
    </Page>
  ),

  PageHeader: () => (
    <Page className="max-w-3xl">
      <BackLink href="/passport" label="Passport" />
      <PageHeader
        title="Professional signals"
        description="How your creator business is trending, computed from your profile and connected accounts."
      />
      <Separator className="my-6" />
      <PageHeader
        title="Access"
        description="Brand programmes, PR and experiences for working creators."
        action={<StatusBadge tone="brand">Preview</StatusBadge>}
      />
      <Separator className="my-6" />
      <PageHeader eyebrow="Internal · Risk admin" title="Risk console" />
    </Page>
  ),

  BackLink: () => (
    <Page>
      <BackLink href="/passport" label="Passport" />
      <p className="text-footnote text-ink-muted">44px tall (touch target) · gold · chevron + parent title.</p>
    </Page>
  ),

  ConsentText: () => (
    <Page className="max-w-xl">
      <Card>
        <CardContent>
          <ConsentText id="ct" definition={CREATOR_PROFILE_CONSENT} />
        </CardContent>
      </Card>
    </Page>
  ),

  FormFooter: () => (
    <div className="min-h-[520px] bg-paper px-4 pt-5 text-ink">
      <form className="flex flex-col gap-6" onSubmit={(e) => e.preventDefault()}>
        <FormField id="ff" label="Display name" required>
          {(a) => <Input {...a} defaultValue="Aarohi Makes" />}
        </FormField>
        <p className="text-subhead text-ink-muted">
          On iPhone the primary action is pinned above the home indicator on a translucent bar; from the sm breakpoint
          it sits inline.
        </p>
        <div className="h-64" />
        <FormFooter>
          <Button size="lg">Save and continue</Button>
        </FormFooter>
      </form>
    </div>
  ),

  TabBar: () => (
    <div className="h-[260px] bg-paper p-5 text-ink">
      <p className="text-subhead text-ink-muted">
        Fixed to the bottom; translucent `bar` + 20px blur; active tab gold.
      </p>
      <TabBar items={CREATOR_NAV} />
    </div>
  ),

  Sidebar: () => (
    <div className="flex h-[520px] bg-paper text-ink">
      <Sidebar
        items={CREATOR_NAV}
        footer={
          <Button variant="ghost" size="sm" className="text-ink-muted">
            Sign out
          </Button>
        }
      />
      <div className="flex-1 p-10">
        <PageHeading>Home</PageHeading>
        <Lede className="mt-2">Sidebar appears from the lg breakpoint (≥ 1024px); the tab bar is hidden.</Lede>
      </div>
    </div>
  ),

  AppShell: () => (
    <AppShell
      nav={CREATOR_NAV}
      sidebarFooter={
        <Button variant="ghost" size="sm" className="text-ink-muted">
          Sign out
        </Button>
      }
    >
      <PageHeader eyebrow="Welcome back" title="Aarohi Makes" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
        <MembershipCard {...CARD} tier="member" />
        <ListGroup id="n" label="Next steps">
          <ListRow href="#" label="Connect a social account" detail="Verifies your creator activity." />
          <ListRow
            href="#"
            label="Turn on professional signals"
            detail="Optional. See how your creator business is trending."
          />
        </ListGroup>
      </div>
    </AppShell>
  ),

  OnboardingShell: () => (
    <OnboardingShell
      progress={<ProgressSteps steps={STEPS} currentKey="about" />}
      eyebrow="About you"
      title="About you"
      description="Your legal name stays private to CreatorCo."
      backHref="/onboarding/welcome"
      actions={
        <Button variant="ghost" size="sm" className="text-ink-muted">
          Sign out
        </Button>
      }
    >
      <form className="flex flex-col gap-6" onSubmit={(e) => e.preventDefault()}>
        <FormField id="ln" label="Legal name" required>
          {(a) => <Input {...a} />}
        </FormField>
        <FormFooter>
          <Button size="lg">Save and continue</Button>
        </FormFooter>
      </form>
    </OnboardingShell>
  ),

  AuthShell: () => (
    <AuthShell title="Create your account" description="Membership is by application. It takes about five minutes.">
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        <FormField id="em" label="Email" required>
          {(a) => <Input {...a} type="email" />}
        </FormField>
        <FormField id="pw2" label="Password" required>
          {(a) => <Input {...a} type="password" />}
        </FormField>
        <RequirementChecklist id="r2" items={PASSWORD_RULES} />
        <Button size="lg">Create account</Button>
      </form>
    </AuthShell>
  ),

  ComplianceNote: () => (
    <Page className="max-w-2xl">
      <ComplianceNote />
    </Page>
  ),

  /* ---------- PROPOSED ---------- */

  ProposedVerificationStates: () => {
    const STATES = [
      {
        Icon: CircleDot,
        tone: "text-ink-subtle",
        label: "Self-declared",
        wording: "You told us this. Not checked.",
        ex: "Legal name",
      },
      {
        Icon: CircleCheck,
        tone: "text-success",
        label: "Verified",
        wording: "Checked against a source — names the source and date.",
        ex: "Creator activity · Instagram, 3 Oct",
      },
      {
        Icon: Sparkles,
        tone: "text-info",
        label: "Derived",
        wording: "Computed from verified data. Shows how.",
        ex: "Posting consistency · from connected accounts",
      },
      {
        Icon: CircleDashed,
        tone: "text-ink-subtle",
        label: "Missing",
        wording: "Not provided — with the action to add it.",
        ex: "Mobile number · Add",
      },
      {
        Icon: CircleAlert,
        tone: "text-warning",
        label: "Needs attention",
        wording: "Something changed or conflicts — with the fix.",
        ex: "Handle differs from what you declared",
      },
    ];
    return (
      <Page className="max-w-2xl">
        <Proposed>
          Five attribute states. Verification applies to individual attributes — never “Verified Passport”.
        </Proposed>
        <ListGroup
          id="pvs"
          label="Attribute states"
          footer="Status is about your creator career — it never sets financial limits."
        >
          {STATES.map((s) => (
            <ListRow
              key={s.label}
              leading={
                <span className={"inline-flex " + s.tone}>
                  <s.Icon aria-hidden="true" className="size-indicator" strokeWidth={2} />
                </span>
              }
              label={s.label}
              detail={`${s.wording} e.g. ${s.ex}`}
            />
          ))}
        </ListGroup>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Alert tone="danger" title="Don't">
            “Verified creator” on the Passport header when only one attribute is verified.
          </Alert>
          <Alert tone="success" title="Do">
            “3 of 6 details verified” with each row showing its own mark.
          </Alert>
        </div>
      </Page>
    );
  },

  ProposedProgressAvailability: () => (
    <Page className="flex max-w-2xl flex-col gap-6">
      <Proposed>
        Onboarding completion is finite; Passport strength is ongoing. Unavailable actions never count against the
        creator.
      </Proposed>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Onboarding</CardTitle>
            <StatusBadge tone="success">Complete</StatusBadge>
          </div>
          <CardDescription>6 of 6 steps · done once, never re-opens.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProgressMeter value={100} label="Onboarding" />
        </CardContent>
      </Card>
      <ListGroup
        id="ps"
        label="Passport strength"
        footer="Strength grows with verified and connected details. It is not a score and never affects financial eligibility."
      >
        <ListRow label="Profile details" value="Complete" accessory={<VerificationMark state="declared" />} />
        <ListRow
          href="#"
          label="Connect a social account"
          detail="Verifies your creator activity."
          accessory={<StatusBadge tone="brand">Next</StatusBadge>}
        />
        <ListRow
          label={<span className="text-ink-muted">Bank-statement income</span>}
          detail="Coming in the next build — not counted yet."
          accessory={<Clock aria-hidden="true" className="size-5 text-ink-subtle" />}
        />
        <ListRow
          label={<span className="text-ink-muted">Moj connection</span>}
          detail="Not available in your region yet — not counted."
          accessory={<Lock aria-hidden="true" className="size-5 text-ink-subtle" />}
        />
      </ListGroup>
      <Alert tone="danger" title="Today (to fix)">
        Onboarding completion stops at 80% because “Connect a creator account” (20%) is counted — the creator cannot
        reach done during onboarding.
      </Alert>
    </Page>
  ),

  ProposedMembershipLifecycle: () => {
    const STAGES = [
      { k: "Applied", d: "Account created · application in progress", b: <StatusBadge>Draft</StatusBadge> },
      {
        k: "Under review",
        d: "We're reviewing your application",
        b: <StatusBadge tone="info">Under review</StatusBadge>,
      },
      { k: "Member", d: "Membership active · Creator Status: Member", b: <CreatorStatusBadge tier="member" /> },
      {
        k: "Invited to Onyx",
        d: "An invitation, not an upgrade you earn by borrowing",
        b: <CreatorStatusBadge tier="onyx" />,
      },
      { k: "Invited to Icon", d: "By invitation only", b: <CreatorStatusBadge tier="icon" /> },
    ];
    return (
      <Page className="max-w-2xl">
        <Proposed>
          Account → application → membership are three different things. Each state has one badge and one sentence.
        </Proposed>
        <ListGroup id="ml" label="Membership lifecycle">
          {STAGES.map((s) => (
            <ListRow key={s.k} label={s.k} detail={s.d} accessory={s.b} />
          ))}
        </ListGroup>
      </Page>
    );
  },

  ProposedOptionalVerification: () => (
    <Page className="max-w-xl">
      <Proposed>
        Prefill reads as a shortcut, not a requirement. Manual entry is the first option and has equal weight.
      </Proposed>
      <div className="flex flex-col gap-6">
        <FormField
          id="pl"
          label="Legal name"
          required
          description="As it appears on your PAN. Kept private to CreatorCo."
        >
          {(a) => <Input {...a} />}
        </FormField>
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-footnote text-ink-subtle">or save time</span>
          <Separator className="flex-1" />
        </div>
        <ListGroup
          id="pf"
          label="Optional shortcuts"
          footer="Optional. Skipping them never lowers your Creator Status."
        >
          <ListRow
            href="#"
            label="Prefill from your mobile number"
            detail="Verify by OTP, then fetch your PAN-linked name."
          />
          <ListRow href="#" label="Look up GST registrations" detail="Finds registrations linked to your PAN." />
        </ListGroup>
      </div>
    </Page>
  ),

  ProposedMissingComponents: () => (
    <Page className="grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Proposed>
          Shapes for the missing primitives, built only from existing tokens. Build on shadcn/ui when needed.
        </Proposed>
      </div>
      <div>
        <GroupLabel className="px-0">Sheet / Dialog</GroupLabel>
        <div className="relative h-56 overflow-hidden rounded-card bg-surface ring-1 ring-line ring-inset">
          <div className="absolute inset-0 bg-paper/60" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-card bg-elevated p-5 shadow-overlay">
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-input-border" />
            <p className="text-headline font-semibold">Disconnect Instagram?</p>
            <p className="mt-1 text-subhead text-ink-muted">
              Your Passport returns to self-declared for this platform.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="destructive" size="sm">
                Disconnect
              </Button>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div>
        <GroupLabel className="px-0">Toast</GroupLabel>
        <div className="flex h-56 items-end justify-center rounded-card bg-surface p-4 ring-1 ring-line ring-inset">
          <div
            role="status"
            className="flex items-center gap-3 rounded-control bg-elevated px-4 py-3 text-subhead shadow-overlay ring-1 ring-line ring-inset"
          >
            <CircleCheck aria-hidden="true" className="size-5 text-success" />
            Account connected
            <button className="ml-2 text-gold">Undo</button>
          </div>
        </div>
      </div>
      <div>
        <GroupLabel className="px-0">Tabs (= SegmentedControl for ≤ 4 views)</GroupLabel>
        <SegmentedControl
          name="t"
          legend="Signals view"
          defaultValue="career"
          options={[
            { value: "career", label: "Career" },
            { value: "aud", label: "Audience" },
            { value: "con", label: "Consistency" },
          ]}
        />
      </div>
      <div>
        <GroupLabel className="px-0">Avatar</GroupLabel>
        <div className="flex items-center gap-3">
          <span className="flex size-touch items-center justify-center rounded-full bg-elevated text-subhead font-semibold ring-1 ring-line ring-inset">
            AM
          </span>
          <span className="flex size-touch items-center justify-center rounded-full bg-gold-soft text-subhead font-semibold text-gold">
            KS
          </span>
        </div>
      </div>
      <div className="sm:col-span-2">
        <GroupLabel className="px-0">Table (risk console)</GroupLabel>
        <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-line ring-inset">
          <table className="w-full text-subhead">
            <thead className="bg-elevated text-left text-footnote text-ink-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Creator</th>
                <th className="px-4 py-2 font-medium">Completeness</th>
                <th className="px-4 py-2 text-right font-medium">Connected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-4 py-2.5">Aarohi Makes</td>
                <td className="px-4 py-2.5 tabular-nums">80%</td>
                <td className="px-4 py-2.5 text-right tabular-nums">0</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5">Kabir on the Road</td>
                <td className="px-4 py-2.5 tabular-nums">100%</td>
                <td className="px-4 py-2.5 text-right tabular-nums">1</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <GroupLabel className="px-0">File upload</GroupLabel>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input-border bg-surface px-4 py-6 text-center">
          <Upload aria-hidden="true" className="size-6 text-ink-muted" />
          <p className="text-subhead">Add a brand contract</p>
          <p className="text-footnote text-ink-subtle">PDF up to 10 MB</p>
        </div>
      </div>
      <div>
        <GroupLabel className="px-0">Tooltip</GroupLabel>
        <div className="inline-block rounded-sm bg-elevated px-3 py-2 text-footnote shadow-overlay ring-1 ring-line ring-inset">
          Months in the last year with new posts.
        </div>
      </div>
    </Page>
  ),

  ProposedDataViz: () => {
    const series = [
      { name: "Instagram", v: [12, 14, 15, 18, 21, 24, 26, 29, 31, 33, 36, 40], c: "var(--viz-1)" },
      { name: "YouTube", v: [4, 5, 5, 6, 7, 7, 8, 9, 10, 11, 11, 12], c: "var(--viz-2)" },
    ];
    const X = (i: number) => 40 + i * 40;
    const Y = (v: number) => 160 - v * 3.2;
    return (
      <Page className="max-w-3xl">
        <Proposed>
          Data-visualisation palette — validated with the dataviz colour checker in both themes (adjacent CVD ΔE ≥ 8).
          Never gold for data; text stays in ink tokens.
        </Proposed>
        <style>{`:root,[data-theme="dark"]{--viz-1:#5b8def;--viz-2:#d47a3e;--viz-3:#34a07f;--viz-4:#a273cc}[data-theme="light"]{--viz-1:#2f6bd8;--viz-2:#c4621e;--viz-3:#1b8a68;--viz-4:#8a52b8}`}</style>
        <Card>
          <CardHeader>
            <CardTitle>Combined audience (K)</CardTitle>
            <CardDescription>About your creator business — not a credit score.</CardDescription>
          </CardHeader>
          <CardContent>
            <svg
              viewBox="0 0 580 190"
              className="w-full"
              role="img"
              aria-label="Combined audience by platform, last 12 months"
            >
              {[0, 10, 20, 30, 40].map((t) => (
                <g key={t}>
                  <line x1="40" x2="480" y1={Y(t)} y2={Y(t)} className="stroke-line" strokeWidth="1" />
                  <text x="32" y={Y(t) + 4} textAnchor="end" className="fill-ink-subtle text-caption-2">
                    {t}
                  </text>
                </g>
              ))}
              {series.map((s) => (
                <g key={s.name}>
                  <polyline
                    fill="none"
                    stroke={s.c}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    points={s.v.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}
                  />
                  <circle cx={X(11)} cy={Y(s.v[11]!)} r="4" fill={s.c} />
                  <text x={X(11) + 8} y={Y(s.v[11]!) + 4} className="fill-ink text-caption">
                    {s.name}
                  </text>
                </g>
              ))}
            </svg>
            <div className="mt-3 flex gap-4">
              {["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"].map((c, i) => (
                <span key={c} className="flex items-center gap-1.5 text-footnote text-ink-muted">
                  <span className="size-3 rounded-sm" style={{ background: c }} /> viz-{i + 1}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </Page>
    );
  },

  ProposedResearchVariants: () => (
    <Page className="grid max-w-4xl grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <Proposed>
          Two testable variants for the open question: does the system signal recognition and belonging as strongly as
          financial credibility?
        </Proposed>
      </div>
      <div>
        <GroupLabel className="px-0">Variant A · today</GroupLabel>
        <ListGroup id="va" label="Professional signals" footer="About your creator business — not a credit score.">
          <ListRow label="Creating for" value="3 yr 8 mo" />
          <ListRow label="Posting consistency" value="91% of months" />
        </ListGroup>
      </div>
      <div>
        <GroupLabel className="px-0">Variant B · editorial recognition moment</GroupLabel>
        <div className="rounded-card bg-surface p-5 ring-1 ring-line ring-inset">
          <Eyebrow className="text-gold">This month</Eyebrow>
          <p className="mt-2 font-serif text-title-2 leading-snug">You&rsquo;ve posted every month for a year.</p>
          <p className="mt-2 text-subhead text-ink-muted">Consistency like this is what brand programmes look for.</p>
          <Button variant="link" className="mt-3">
            See your signals <ArrowUpRight />
          </Button>
        </div>
      </div>
    </Page>
  ),

  /* ---------- PROPOSED screens (compositions of existing components) ---------- */

  ScreenStatusReveal: () => (
    <div className="flex min-h-[760px] flex-col items-center justify-center bg-paper px-6 text-center text-ink">
      <Proposed>Status reveal — the exclusivity moment. Not built yet.</Proposed>
      <Eyebrow className="text-gold">Creator Status</Eyebrow>
      <p className="mt-3 font-serif text-[40px] leading-tight">You&rsquo;re invited to Onyx.</p>
      <p className="mt-3 max-w-sm text-subhead text-ink-muted">
        For four years of consistent, verified work. Status is about your creator career — it never sets financial
        limits.
      </p>
      <MembershipCard {...CARD} tier="onyx" className="mt-8 w-[340px]" />
      <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
        <Button size="lg">Accept invitation</Button>
        <Button size="lg" variant="ghost">
          Not now
        </Button>
      </div>
    </div>
  ),

  ScreenEligibilityResult: () => (
    <div className="min-h-[760px] bg-paper px-4 pt-5 pb-10 text-ink">
      <Proposed>Eligibility result — plain, calm, no decoration. Not built (Stage 08+).</Proposed>
      <BackLink href="#" label="Home" />
      <PageHeader
        title="Financial eligibility"
        description="A CreatorCo recommendation based on your Financial Capacity."
      />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Proposed eligibility</CardTitle>
            <StatusBadge tone="info">CreatorCo recommendation</StatusBadge>
          </div>
          <CardDescription>Subject to partner-lender approval.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-title-1 font-bold tabular-nums">₹1,50,000 – ₹2,00,000</p>
          <p className="mt-1 text-footnote text-ink-muted">Working-capital line · for reference only</p>
        </CardContent>
      </Card>
      <ListGroup
        id="basis"
        label="What this is based on"
        className="mt-8"
        footer="Follower count is not a factor. Creator Status is not a factor."
      >
        <ListRow label="Financial Capacity" value="Steady" />
        <ListRow label="Income consistency" value="14 of 15 months" />
        <ListRow label="Business documentation" value="Partial" />
      </ListGroup>
      <Alert tone="info" className="mt-6">
        CreatorCo is not a bank or lender. Any financial product will be offered by a regulated partner bank or NBFC and
        is subject to its approval.
      </Alert>
      <div className="mt-6">
        <Button size="lg" className="w-full">
          Continue to partner
        </Button>
      </div>
    </div>
  ),

  ScreenMembershipCard: () => (
    <div className="min-h-[760px] bg-paper px-4 pt-5 pb-10 text-ink">
      <Proposed>Membership card screen with the “not a payment card” convention.</Proposed>
      <PageHeader title="Membership card" />
      <MembershipCard {...CARD} tier="member" />
      <p className="mt-3 flex items-center gap-1.5 px-1 text-footnote text-ink-subtle">
        <Lock aria-hidden="true" className="size-3.5" /> Membership card — not a payment card.
      </p>
      <ListGroup id="mc" label="Membership" className="mt-8">
        <ListRow label="Member number" value={<span className="font-mono">CC 0000 0001</span>} />
        <ListRow label="Member since" value="September 2026" />
        <ListRow label="Creator Status" accessory={<CreatorStatusBadge tier="member" />} />
      </ListGroup>
    </div>
  ),

  ScreenInvitation: () => (
    <div className="flex min-h-[760px] flex-col bg-paper px-5 pt-6 pb-10 text-ink">
      <Proposed>Invitation landing variant (when someone arrives with an invite code).</Proposed>
      <Wordmark />
      <div className="mt-16">
        <Eyebrow className="text-gold">By invitation</Eyebrow>
        <DisplayHeading className="mt-3">Kabir thinks your work belongs here.</DisplayHeading>
        <Lede className="mt-4">
          CreatorCo is a professional and financial network for creators — membership is by application.
        </Lede>
      </div>
      <div className="mt-10 flex flex-col gap-3">
        <Button size="lg">Accept invitation</Button>
        <Button size="lg" variant="secondary">
          What is CreatorCo?
        </Button>
      </div>
      <ComplianceNote className="mt-auto pt-10" />
    </div>
  ),
};

const PATHS: Record<string, string> = { TabBar: "/dashboard", Sidebar: "/passport", AppShell: "/dashboard" };

export function mount(name: string, el?: HTMLElement | null) {
  const target = el ?? document.getElementById("root");
  const Spec = S[name];
  if (!target || !Spec) throw new Error(`Unknown specimen ${name}`);
  (globalThis as unknown as { __ccPathname?: string }).__ccPathname = PATHS[name] ?? "/dashboard";
  createRoot(target).render(<Spec />);
}

export const specimens = Object.keys(S);
