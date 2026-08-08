import { describe, expect, test } from "bun:test";
import { resolveDefaultDomainId } from "../src/app/lib/default-domain";
import type { DomainDTO } from "../src/shared/types";

const domain = (id: string): DomainDTO =>
  ({ id, hostname: `${id}.example.com`, status: "active" }) as DomainDTO;

describe("resolveDefaultDomainId (#69)", () => {
  test("uses the stored default when the domain is still serving", () => {
    expect(resolveDefaultDomainId("d1", [domain("d1"), domain("d2")])).toBe("d1");
  });

  test("falls back to the shared domain when nothing is stored", () => {
    expect(resolveDefaultDomainId(null, [domain("d1")])).toBeNull();
    expect(resolveDefaultDomainId(undefined, [domain("d1")])).toBeNull();
  });

  test("falls back when the stored domain is gone, stopped serving, or is out of plan", () => {
    // All three arrive the same way: the domain is simply not in the org's
    // active list. Deleted rows vanish, pending and error ones are filtered,
    // and a plan without custom domains fetches no list at all.
    expect(resolveDefaultDomainId("d1", [domain("d2")])).toBeNull();
    expect(resolveDefaultDomainId("d1", [])).toBeNull();
  });
});
