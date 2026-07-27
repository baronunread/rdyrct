import { describe, expect, test } from "bun:test";
import { canListOrgDomains } from "../src/app/lib/org-limits";

describe("canListOrgDomains", () => {
  test("platform admins can always list domains", () => {
    expect(canListOrgDomains(true, undefined)).toBe(true);
    expect(canListOrgDomains(true, "member")).toBe(true);
  });

  test("org owners and admins can list domains", () => {
    expect(canListOrgDomains(false, "owner")).toBe(true);
    expect(canListOrgDomains(false, "admin")).toBe(true);
  });

  test("members and org-less users cannot", () => {
    expect(canListOrgDomains(false, "member")).toBe(false);
    expect(canListOrgDomains(false, undefined)).toBe(false);
  });
});
