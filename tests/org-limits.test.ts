import { describe, expect, test } from "bun:test";
import { canListOrgDomains, canWriteOrg } from "../src/app/lib/org-limits";

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
