import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, authEnv, fetchWorker, freeOwnerCookie, jsonBody } from "./support";
import { getAuth, googleEmailOf } from "../../src/worker/better-auth";

/**
 * The Signing in group on Settings names the Google account a user linked:
 * its address comes off the id token when the account is linked, is
 * refreshed on each later sign-in, and reaches the page through BetterAuth's
 * own /list-accounts.
 */

/** What these tests put in a token's header or payload. */
type Claims = { alg?: string; email?: string; sub?: string };

/** An unsigned id token carrying `claims`: all googleEmailOf reads is the payload. */
function idToken(claims: Claims): string {
  const part = (value: Claims) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

beforeEach(applyTestMigrations);
afterEach(reset);

describe("googleEmailOf", () => {
  it("reads the address from the token's payload, lower-cased", () => {
    expect(googleEmailOf(idToken({ email: "Franco.Toth@gmail.com", sub: "1" }))).toBe(
      "franco.toth@gmail.com",
    );
  });

  it("is null with no token, a broken one, or none in it", () => {
    expect(googleEmailOf(null)).toBeNull();
    expect(googleEmailOf(undefined)).toBeNull();
    expect(googleEmailOf("not-a-jwt")).toBeNull();
    expect(googleEmailOf("a.%%%.c")).toBeNull();
    expect(googleEmailOf(idToken({ sub: "1" }))).toBeNull();
    expect(googleEmailOf(idToken({ email: "not an address" }))).toBeNull();
  });
});

describe("a linked Google account's address", () => {
  const storedEmail = () =>
    env.DB.prepare("select email from account where provider_id = 'google'").first<string | null>(
      "email",
    );

  it("is kept on link, refreshed on sign-in, and listed with the account", async () => {
    const cookie = await freeOwnerCookie();
    const ctx = await getAuth(authEnv()).$context;
    const linked = await ctx.internalAdapter.createAccount({
      userId: "free-1",
      providerId: "google",
      accountId: "google-sub-1",
      idToken: idToken({ email: "free.person@gmail.com" }),
    });
    expect(await storedEmail()).toBe("free.person@gmail.com");

    // A later sign-in writes the new tokens through an update.
    await ctx.internalAdapter.updateAccount(linked.id, {
      idToken: idToken({ email: "renamed@gmail.com" }),
    });
    expect(await storedEmail()).toBe("renamed@gmail.com");

    const res = await fetchWorker(
      new Request("http://localhost/api/auth/list-accounts", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const accounts = await jsonBody<{ providerId: string; email?: string | null }[]>(res);
    expect(accounts.find((a) => a.providerId === "google")?.email).toBe("renamed@gmail.com");
    expect(accounts.find((a) => a.providerId === "credential")?.email ?? null).toBeNull();
  });

  it("stays null for an account linked with no id token", async () => {
    await freeOwnerCookie();
    const ctx = await getAuth(authEnv()).$context;
    await ctx.internalAdapter.createAccount({
      userId: "free-1",
      providerId: "google",
      accountId: "google-sub-2",
    });
    expect(await storedEmail()).toBeNull();
  });
});
