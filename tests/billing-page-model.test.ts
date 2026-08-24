import { describe, expect, test } from "bun:test";
import { shouldOfferFirstLink } from "../src/app/routes/billing";

const org = { id: "org-1", name: "Acme", plan: "free" as const };

describe("shouldOfferFirstLink", () => {
  test("offers the hand-off before an account has an organization", () => {
    expect(shouldOfferFirstLink(null, undefined)).toBe(true);
  });

  test("waits for an existing organization's quota instead of treating it as empty", () => {
    expect(shouldOfferFirstLink(org, undefined)).toBe(false);
  });

  test("offers the hand-off only after the quota resolves to zero", () => {
    expect(shouldOfferFirstLink(org, 0)).toBe(true);
    expect(shouldOfferFirstLink(org, 1)).toBe(false);
  });
});
