import { describe, expect, it } from "vitest";

import { pendingMigrations } from "@/db/scripts/check";

const journal = [
  { tag: "0009_a", when: 100 },
  { tag: "0010_b", when: 200 },
  { tag: "0011_c", when: 300 },
];

describe("db:check pending migrations", () => {
  it("lists everything for a fresh database", () => {
    expect(pendingMigrations(journal, null)).toEqual(["0009_a", "0010_b", "0011_c"]);
  });
  it("lists only migrations newer than the last applied one", () => {
    expect(pendingMigrations(journal, 100)).toEqual(["0010_b", "0011_c"]);
  });
  it("is empty when the database is current", () => {
    expect(pendingMigrations(journal, 300)).toEqual([]);
  });
});
