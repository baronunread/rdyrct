import { describe, expect, test } from "bun:test";
import { planFor, type Needs } from "../src/app/lib/plan-finder";

const base: Needs = { links: 10, members: 1, domains: 0, analyticsDays: 7 };

describe("planFor", () => {
  test("anything inside the free limits is Free, with nothing over", () => {
    expect(planFor(base)).toEqual({ plan: "free", over: [], below: null });
    expect(planFor({ ...base, links: 30, members: 3 }).plan).toBe("free");
  });

  test("each free limit, one past it, needs Hobby and names the limit", () => {
    expect(planFor({ ...base, links: 31 })).toEqual({
      plan: "hobby",
      below: "free",
      over: [{ key: "links", need: 31, limit: 30 }],
    });
    expect(planFor({ ...base, members: 4 }).plan).toBe("hobby");
    expect(planFor({ ...base, domains: 1 }).plan).toBe("hobby");
    expect(planFor({ ...base, analyticsDays: 8 }).plan).toBe("hobby");
  });

  test("each Hobby limit, one past it, needs Pro", () => {
    expect(planFor({ ...base, links: 501 }).plan).toBe("pro");
    expect(planFor({ ...base, members: 6 }).plan).toBe("pro");
    expect(planFor({ ...base, domains: 2 }).plan).toBe("pro");
    expect(planFor({ ...base, analyticsDays: 31 }).plan).toBe("pro");
    expect(
      planFor({ ...base, links: 3000, members: 25, domains: 5, analyticsDays: 365 }).plan,
    ).toBe("pro");
  });

  test("past Pro there is no plan, and every limit it breaks is named", () => {
    expect(planFor({ ...base, links: 3001, members: 26 })).toEqual({
      plan: null,
      below: "pro",
      over: [
        { key: "links", need: 3001, limit: 3000 },
        { key: "members", need: 26, limit: 25 },
      ],
    });
  });
});
