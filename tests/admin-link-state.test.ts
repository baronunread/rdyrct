import { describe, expect, test } from "bun:test";
import { linkState, linkStateDetail, linkStateRank } from "../src/app/routes/admin/link-state";

const base = { riskScore: 0, riskReasons: [] };

describe("linkState", () => {
  test("the worst state wins, in the documented order", () => {
    const held = { ...base, suspendedAt: 1, warnedAt: 1 };
    expect(linkState({ ...held, riskScore: 100 })).toBe("blocked");
    expect(linkState(held)).toBe("suspended");
    expect(linkState({ ...base, warnedAt: 1 })).toBe("warning");
    expect(linkState({ ...base, riskScore: 40 })).toBe("risky");
    expect(linkState(base)).toBe("clean");
    expect(linkState({ ...base, riskScore: null })).toBe("unscored");
  });

  test("unscored is not clean, and sorts after it", () => {
    expect(linkStateRank({ ...base, riskScore: null })).toBeGreaterThan(linkStateRank(base));
    expect(linkStateRank({ ...base, riskScore: 100 })).toBe(0);
  });
});

describe("linkStateDetail", () => {
  test("a hold names its reason and the risk verdict", () => {
    expect(
      linkStateDetail({ ...base, suspendedAt: 1, suspendReason: "Phishing report, ticket 412" }),
    ).toBe("Suspended: Phishing report, ticket 412 · Risk: clean");
  });

  test("a blocklist hit names the list, and no separate risk line", () => {
    expect(
      linkStateDetail({ ...base, riskScore: 100, riskReasons: ["web_risk_social_engineering"] }),
    ).toBe("Blocked: Google: social engineering");
    expect(
      linkStateDetail({
        ...base,
        riskScore: 100,
        riskReasons: ["dns_blocklist"],
        warnedAt: 1,
        warnReason: null,
      }),
    ).toBe("Blocked: DNS blocklist · Warning: no reason given");
  });

  test("an unscored link says so", () => {
    expect(linkStateDetail({ ...base, riskScore: null })).toBe("Risk: unscored");
  });
});
