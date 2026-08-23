import { describe, expect, test } from "bun:test";
import { canListOrgDomains, canWriteOrg, domainsBlockedBy } from "../src/app/lib/org-limits";

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

describe("canWriteOrg", () => {
  test("owner, admin and member may write", () => {
    expect(canWriteOrg("owner")).toBe(true);
    expect(canWriteOrg("admin")).toBe(true);
    expect(canWriteOrg("member")).toBe(true);
  });

  test("a viewer may not", () => {
    expect(canWriteOrg("viewer")).toBe(false);
  });

  test("no role yet is not a moment to offer a write", () => {
    expect(canWriteOrg(undefined)).toBe(false);
  });
});

describe("domainsBlockedBy", () => {
  test("a plan with domains and no lock blocks nothing", () => {
    expect(domainsBlockedBy(3, false)).toBe(null);
  });

  test("a plan with no domains says so", () => {
    expect(domainsBlockedBy(0, false)).toBe("plan");
  });

  test("a locked org on a plan that does include domains is blocked by the lock", () => {
    // The reason this exists. Answering "custom domains need a paid plan"
    // here tells a Hobby owner to buy what they already have, and points at
    // an upgrade that would not unlock the org.
    expect(domainsBlockedBy(3, true)).toBe("lock");
  });

  test("the lock wins when both are true, because upgrading is not the way out", () => {
    expect(domainsBlockedBy(0, true)).toBe("lock");
  });
});
