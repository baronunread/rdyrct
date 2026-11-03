import { describe, expect, test } from "bun:test";
import { recheckMessage } from "../src/app/lib/domain-messages";

describe("recheckMessage", () => {
  test("still checking_dns: nudges toward the DNS provider", () => {
    expect(recheckMessage("checking_dns", "checking_dns")).toBe(
      "CNAME record not detected yet: create it at your DNS provider to continue",
    );
  });

  test("still issuing_tls: reassures the cert is on the way", () => {
    expect(recheckMessage("issuing_tls", "issuing_tls")).toBe(
      "Certificate still being issued, usually takes a few minutes",
    );
  });

  test("unchanged and not transitional: nothing worth saying", () => {
    expect(recheckMessage("active", "active")).toBeNull();
    expect(recheckMessage("error", "error")).toBeNull();
  });

  test("newly active: says so", () => {
    expect(recheckMessage("issuing_tls", "active")).toBe("Domain is active");
  });

  test("DNS just resolved: moves to issuing_tls", () => {
    expect(recheckMessage("checking_dns", "issuing_tls")).toBe(
      "DNS resolved. Issuing TLS certificate…",
    );
  });

  test("any other transition: nothing worth saying", () => {
    expect(recheckMessage("checking_dns", "error")).toBeNull();
  });
});
