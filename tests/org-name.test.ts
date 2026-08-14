import { describe, expect, test } from "bun:test";
import { defaultOrgName } from "../src/shared/org-name";

/**
 * Naming somebody's first organization for them (#65).
 *
 * Only defensible because the name is shown before it is used and renameable
 * afterwards, so the bar is "a reasonable guess", not "correct". What it must
 * never do is produce something empty or absurd, since that is what the person
 * sees on their first screen.
 */

describe("a work address names the organization", () => {
  test("uses the domain, without its top-level part", () => {
    expect(defaultOrgName("andrea@acme.com")).toBe("Acme");
  });

  test("keeps the rest of a multi-part domain", () => {
    // "Acme" alone would be a guess about public suffixes that needs a table
    // to get right, and getting it wrong reads worse than keeping the label.
    expect(defaultOrgName("andrea@acme.co.uk")).toBe("Acme Co");
  });

  test("reads a hyphenated domain as words", () => {
    expect(defaultOrgName("sam@harbor-analytics.io")).toBe("Harbor Analytics");
  });

  test("ignores the account name when the domain is a real one", () => {
    expect(defaultOrgName("sam@acme.com", "Sam Patel")).toBe("Acme");
  });
});

describe("a personal address names the person", () => {
  test("uses the account name for a consumer provider", () => {
    expect(defaultOrgName("sam@gmail.com", "Sam Patel")).toBe("Sam Patel's links");
  });

  test("falls back to the local part when there is no name", () => {
    expect(defaultOrgName("sam.patel@outlook.com")).toBe("Sam Patel's links");
  });

  test("covers the providers people actually use", () => {
    for (const domain of ["gmail.com", "icloud.com", "proton.me", "yahoo.com", "hotmail.com"]) {
      expect(defaultOrgName(`sam@${domain}`, "Sam")).toBe("Sam's links");
    }
  });
});

describe("never empty, never absurd", () => {
  test("survives an address with no domain", () => {
    expect(defaultOrgName("sam")).toBe("Sam's links");
  });

  test("survives an empty address", () => {
    expect(defaultOrgName("")).toBe("My links");
  });

  test("stays inside the name column's limit", () => {
    const long = `${"a".repeat(200)}@${"b".repeat(200)}.com`;
    expect(defaultOrgName(long).length).toBeLessThanOrEqual(100);
  });
});
