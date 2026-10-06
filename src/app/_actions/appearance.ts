"use server";

import { cookies } from "next/headers";

import { APPEARANCE_COOKIE, parseAppearance } from "@/lib/appearance";

export async function setAppearanceAction(value: string): Promise<void> {
  const store = await cookies();
  store.set(APPEARANCE_COOKIE, parseAppearance(value), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
