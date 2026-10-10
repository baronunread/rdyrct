import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { name } from "@gdp-ts/core";
import type { SessionUser } from "../../src/worker/env";
import * as schema from "../../src/worker/db/schema";
import { canDeleteOrg } from "../../src/worker/proofs/can-delete-org";
import { applyTestMigrations, testDb } from "./support";

const user: SessionUser = {
  id: "proof-owner",
  email: "proof@example.com",
  name: "Owner",
  isAdmin: false,
  emailVerified: true,
  plan: "free",
  polarSubscriptionCancelAtPeriodEnd: false,
  polarSubscriptionCurrentPeriodEnd: null,
  image: null,
};

beforeEach(async () => {
  await applyTestMigrations();
  await testDb()
    .insert(schema.user)
    .values({
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
  await testDb()
    .insert(schema.orgs)
    .values([
      { id: "owned", name: "Owned", createdAt: 0 },
      { id: "other", name: "Other", createdAt: 0 },
    ]);
  await testDb().insert(schema.orgMembers).values({
    orgId: "owned",
    userId: user.id,
    role: "owner",
    createdAt: 0,
  });
});
afterEach(reset);

describe("org deletion evidence checks live roles", () => {
  it("allows the owner and platform admin", async () => {
    await name(user, "owned", async (actor, org) => {
      expect((await canDeleteOrg(testDb(), actor, org)).kind).toBe("CanDeleteOrg");
    });
    await name({ ...user, isAdmin: true }, "other", async (actor, org) => {
      expect((await canDeleteOrg(testDb(), actor, org)).kind).toBe("CanDeleteOrg");
    });
  });
  it("rejects a different user or org", async () => {
    await name({ ...user, id: "other-user" }, "owned", async (actor, org) => {
      await expect(canDeleteOrg(testDb(), actor, org)).rejects.toThrow("Insufficient role");
    });
    await name(user, "other", async (actor, org) => {
      await expect(canDeleteOrg(testDb(), actor, org)).rejects.toThrow("Insufficient role");
    });
  });
});
