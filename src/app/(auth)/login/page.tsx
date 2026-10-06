import type { Metadata } from "next";

import { AuthShell } from "@/components/creatorco";

import { redirectIfSignedIn } from "../redirect-if-signed-in";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await redirectIfSignedIn();
  const { next } = await searchParams;
  return (
    <AuthShell title="Welcome back" description="Sign in to your CreatorCo membership.">
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthShell>
  );
}
