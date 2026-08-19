import { describe, expect, test } from "bun:test";
import { dashboardView } from "../src/app/routes/dashboard";

describe("dashboardView", () => {
  test("waits for the user query before deciding there's no org", () => {
    expect(dashboardView(true, false, false, false)).toBe("userLoading");
    expect(dashboardView(true, true, false, true)).toBe("userLoading");
  });

  test("shows the org-creation form once the user query settles with no org", () => {
    expect(dashboardView(false, false, false, false)).toBe("noOrg");
  });

  test("shows the skeleton while an org's stats are loading", () => {
    expect(dashboardView(false, true, true, false)).toBe("statsLoading");
  });

  test("shows an error once stats settle with nothing to show", () => {
    expect(dashboardView(false, true, false, false)).toBe("statsError");
  });

  test("is ready once the user, org and stats have all arrived", () => {
    expect(dashboardView(false, true, false, true)).toBe("ready");
  });
});
