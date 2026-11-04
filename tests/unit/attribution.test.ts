import { describe, expect, it } from "vitest";

import {
  attributionFrom,
  cleanSlug,
  decodeAttribution,
  encodeAttribution,
  parseCampaigns,
  reduceTags,
  referrerKind,
} from "@/modules/analytics/attribution";
import { parseEventProps } from "@/modules/analytics/events";

const campaigns = parseCampaigns("diwali_2026, Meetup BLR ,bad@value");

describe("sign-up attribution", () => {
  it("slugs are short and lowercase", () => {
    expect(cleanSlug(" Instagram ")).toBe("instagram");
    expect(cleanSlug("Diwali Drop+2026")).toBe("diwali_drop_2026");
    for (const bad of ["kabir@example.com", "a.b", "x".repeat(41), "", "-lead"]) expect(cleanSlug(bad), bad).toBeNull();
  });

  it("keeps only reviewed values: allow-listed source/medium, registered campaigns, else other", () => {
    expect([...campaigns]).toEqual(["diwali_2026", "meetup_blr"]);
    expect(reduceTags({ utm_source: "Instagram", utm_medium: "Bio", utm_campaign: "Diwali_2026" }, campaigns)).toEqual({
      utm_source: "instagram",
      utm_medium: "bio",
      utm_campaign: "diwali_2026",
    });
    // Free-text tags can carry a phone number, a name or a PAN — none of it is kept.
    expect(
      reduceTags({ utm_source: "919876543210", utm_medium: "Aarohi Menon", utm_campaign: "ABCPM1234Q" }, campaigns),
    ).toEqual({ utm_source: "other", utm_medium: "other", utm_campaign: "other" });
    expect(reduceTags({}, campaigns)).toEqual({ utm_source: null, utm_medium: null, utm_campaign: null });
  });

  it("records the kind of referring site, never the address", () => {
    expect(referrerKind("https://www.google.co.in/search?q=x", "creatorco.in")).toBe("search");
    expect(referrerKind("https://l.instagram.com/?u=x", "creatorco.in")).toBe("social");
    expect(referrerKind("https://t.co/abc", "creatorco.in")).toBe("social");
    expect(referrerKind("https://someblog.example/post", "creatorco.in")).toBe("other");
    expect(referrerKind("https://creatorco.in/signup", "creatorco.in")).toBeNull();
    expect(referrerKind("not a url", "creatorco.in")).toBeNull();
  });

  it("reads tags and referrer from a landing URL, and is null when there's nothing", () => {
    const q = new URLSearchParams("utm_source=YouTube&utm_campaign=launch&utm_term=secret");
    expect(attributionFrom(q, null, "creatorco.in", campaigns)).toEqual({
      utm_source: "youtube",
      utm_medium: null,
      utm_campaign: "other",
      referrer: null,
    });
    expect(attributionFrom(new URLSearchParams(""), null, "creatorco.in", campaigns)).toBeNull();
  });

  it("round-trips through the cookie and reduces again on the way back (the cookie is client-held)", () => {
    const a = {
      utm_source: "instagram" as const,
      utm_medium: null,
      utm_campaign: "diwali_2026",
      referrer: "social" as const,
    };
    expect(decodeAttribution(encodeAttribution(a), campaigns)).toEqual(a);
    expect(decodeAttribution("utm_source=a%40b.com&utm_campaign=kabir_9876543210&referrer=evil", campaigns)).toEqual({
      utm_source: "other",
      utm_medium: null,
      utm_campaign: "other",
      referrer: null,
    });
  });

  it("account_created v2 accepts only reviewed values", () => {
    expect(parseEventProps("account_created", { client: "web" })).toEqual({
      client: "web",
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      referrer: null,
    });
    expect(() => parseEventProps("account_created", { client: "web", utm_source: "someblog" })).toThrow();
    expect(() => parseEventProps("account_created", { client: "web", utm_campaign: "a@b.com" })).toThrow();
    expect(() => parseEventProps("account_created", { client: "web", referrer: "https://x.com" })).toThrow();
    expect(() => parseEventProps("account_created", { client: "web", utm_term: "x" })).toThrow();
  });
});
