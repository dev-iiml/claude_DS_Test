import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import { CONSENT_KEYS } from "@/modules/consent/domain";
import { normaliseBrandName } from "@/modules/brand-work/rules";
import { syncBrandWorkPoints } from "@/modules/brand-work/points";
import { sampleKey } from "@/providers/document-storage/sample-documents";

import type { Database } from "../create-db";
import {
  brandAliases,
  brandDirectory,
  brandWorkDocuments,
  brandWorkRecords,
  brandWorkReviews,
  consentReceipts,
} from "../schema";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Stage 18 demo: FICTIONAL brand work for Kabir (demo creator 2), in several
 * review states, with generated sample documents (keys under `bw/5eed…`, which
 * the mock storage regenerates as a "fictional sample" PDF). No real brand,
 * invoice, amount or person.
 */
const uuid = (prefix: string, n: number) => `00000000-0000-4000-${prefix}-${String(n).padStart(12, "0")}`;
export const brandWorkDemoIds = {
  receipt: (n: number) => uuid("800a", n),
  directory: (n: number) => uuid("800b", n),
  record: (n: number) => uuid("800c", n),
  document: (n: number) => uuid("800d", n),
};

const DIRECTORY = [
  { n: 1, name: "Wanderlane Luggage", industry: "travel_hospitality" },
  { n: 2, name: "Peakline Outdoors", industry: "fashion_apparel" },
  { n: 3, name: "Chai Theory Cafes", industry: "food_beverage" },
  { n: 4, name: "Skyroute Travel App", industry: "travel_hospitality" },
] as const;

const SEED_AT = new Date("2026-10-20T06:30:00.000Z");

export async function seedBrandWorkDemo(
  tx: Tx,
  input: { userId: string; creatorId: string; reviewerA: string; reviewerB: string },
) {
  const def = CONSENT_DEFINITION_SEEDS.find((d) => d.key === CONSENT_KEYS.brandWorkRecords)!;
  await tx
    .insert(consentReceipts)
    .values({
      id: brandWorkDemoIds.receipt(2),
      userId: input.userId,
      consentDefinitionId: def.id,
      status: "granted",
      grantedAt: SEED_AT,
      source: "settings",
      metadata: { surface: "seed" },
      createdAt: SEED_AT,
    })
    .onConflictDoNothing();
  for (const d of DIRECTORY) {
    await tx
      .insert(brandDirectory)
      .values({
        id: brandWorkDemoIds.directory(d.n),
        canonicalName: d.name,
        industryCode: d.industry,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })
      .onConflictDoNothing();
    await tx
      .insert(brandAliases)
      .values({ alias: normaliseBrandName(d.name), directoryId: brandWorkDemoIds.directory(d.n), createdAt: SEED_AT })
      .onConflictDoNothing();
  }
  const base = {
    creatorId: input.creatorId,
    userId: input.userId,
    consentReceiptId: brandWorkDemoIds.receipt(2),
    currency: "INR",
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  };
  const records = [
    {
      n: 1,
      endBrandName: "Wanderlane Luggage",
      brand: 1,
      billedPartyType: "brand" as const,
      billedPartyName: "Wanderlane Luggage",
      industryCode: "travel_hospitality",
      platforms: ["instagram"],
      deliverables: ["reel", "story"],
      description: "Monsoon carry-on campaign",
      workDate: "2026-06-12",
      invoiceDate: "2026-06-20",
      invoiceAmountPaise: 85_000_00,
      verificationStatus: "verified" as const,
      paymentStatus: "confirmed" as const,
      paymentConfirmationMethod: "agency_confirmation" as const,
      paymentConfirmedMonth: "2026-07-01",
    },
    {
      n: 2,
      endBrandName: "Wanderlane Luggage",
      brand: 1,
      billedPartyType: "agency" as const,
      billedPartyName: "Northstar Creator Agency",
      industryCode: "travel_hospitality",
      platforms: ["instagram", "youtube"],
      deliverables: ["integrated_video"],
      description: "Festive travel edit",
      workDate: "2026-09-02",
      invoiceDate: "2026-09-10",
      invoiceAmountPaise: 1_20_000_00,
      verificationStatus: "verified" as const,
      paymentStatus: "unconfirmed" as const,
      requestedConfirmation: "remittance_advice" as const,
    },
    {
      n: 3,
      endBrandName: "Peakline Outdoors",
      brand: 2,
      billedPartyType: "brand" as const,
      billedPartyName: "Peakline Outdoors",
      industryCode: "fashion_apparel",
      platforms: ["youtube"],
      deliverables: ["dedicated_video"],
      description: "Winter trek gear review",
      workDate: "2026-02-15",
      invoiceDate: "2026-02-28",
      invoiceAmountPaise: 60_000_00,
      verificationStatus: "verified" as const,
      visibility: "private" as const,
    },
    {
      n: 4,
      endBrandName: "Chai Theory",
      brand: null,
      billedPartyType: "brand" as const,
      billedPartyName: "Chai Theory",
      industryCode: "food_beverage",
      platforms: ["instagram"],
      deliverables: ["reel"],
      description: "Cafe opening in Jaipur",
      workDate: "2026-10-05",
      invoiceDate: "2026-10-08",
      invoiceAmountPaise: 25_000_00,
      verificationStatus: "in_review" as const,
      submittedAt: new Date("2026-10-18T05:00:00.000Z"),
    },
    {
      n: 5,
      endBrandName: "Skyroute",
      brand: 4,
      billedPartyType: "platform" as const,
      billedPartyName: "Collab Marketplace",
      industryCode: "travel_hospitality",
      platforms: ["instagram"],
      deliverables: ["story"],
      description: "App launch stories",
      workDate: "2026-08-20",
      invoiceDate: null,
      invoiceAmountPaise: null,
      verificationStatus: "needs_info" as const,
      reasonCode: "documents_unreadable",
      submittedAt: new Date("2026-09-01T05:00:00.000Z"),
    },
    {
      n: 6,
      endBrandName: "Peakline Outdoors",
      brand: 2,
      billedPartyType: "brand" as const,
      billedPartyName: "Peakline Outdoors",
      industryCode: "fashion_apparel",
      platforms: ["instagram"],
      deliverables: ["post"],
      description: "Spring collection post (draft)",
      workDate: "2026-10-25",
      invoiceDate: null,
      invoiceAmountPaise: null,
      verificationStatus: "draft" as const,
    },
  ];
  for (const r of records) {
    const verified = r.verificationStatus === "verified";
    await tx
      .insert(brandWorkRecords)
      .values({
        ...base,
        id: brandWorkDemoIds.record(r.n),
        endBrandName: r.endBrandName,
        brandDirectoryId: r.brand ? brandWorkDemoIds.directory(r.brand) : null,
        billedPartyType: r.billedPartyType,
        billedPartyName: r.billedPartyName,
        industryCode: r.industryCode,
        industryConfirmed: verified,
        platforms: r.platforms,
        deliverables: r.deliverables,
        visibility: "visibility" in r ? r.visibility : "show_on_passport",
        description: r.description,
        workDate: r.workDate,
        invoiceDate: r.invoiceDate,
        invoiceAmountPaise: r.invoiceAmountPaise,
        verificationStatus: r.verificationStatus,
        paymentStatus: "paymentStatus" in r ? r.paymentStatus : "unconfirmed",
        paymentConfirmationMethod: "paymentConfirmationMethod" in r ? r.paymentConfirmationMethod : null,
        paymentConfirmedMonth: "paymentConfirmedMonth" in r ? r.paymentConfirmedMonth : null,
        requestedConfirmation: "requestedConfirmation" in r ? r.requestedConfirmation : null,
        reasonCode: "reasonCode" in r ? r.reasonCode : null,
        rulesVersion: r.verificationStatus === "draft" ? null : "bw-0.1.0",
        firstReviewerId: verified ? input.reviewerA : null,
        submittedAt: "submittedAt" in r ? r.submittedAt : verified ? SEED_AT : null,
        verifiedAt: verified ? SEED_AT : null,
        paymentConfirmedAt: "paymentConfirmedMonth" in r ? SEED_AT : null,
      })
      .onConflictDoNothing();
    if (r.verificationStatus !== "draft") {
      await tx
        .insert(brandWorkDocuments)
        .values({
          id: brandWorkDemoIds.document(r.n),
          recordId: brandWorkDemoIds.record(r.n),
          creatorId: input.creatorId,
          kind: "invoice",
          storageKey: sampleKey(r.n),
          storageProvider: "mock",
          sha256: (r.n.toString(16).padStart(2, "0") + "5eed").padEnd(64, "0"),
          mimeType: "application/pdf",
          sizeBytes: 900,
          scanStatus: "clean",
          uploadedAt: SEED_AT,
        })
        .onConflictDoNothing();
    }
    if (verified) {
      await tx
        .insert(brandWorkReviews)
        .values({
          recordId: brandWorkDemoIds.record(r.n),
          reviewerId: input.reviewerA,
          action: "verify",
          revision: 1,
          createdAt: SEED_AT,
        })
        .onConflictDoNothing();
    }
  }
  await syncBrandWorkPoints(tx, input.creatorId, SEED_AT);
}
