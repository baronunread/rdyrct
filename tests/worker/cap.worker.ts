import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, captureEmails, fetchWorker, jsonBody, overrideEnv } from "./support";
import type { JsonValue } from "../../src/shared/types";

/** What /api/cap/:scope/challenge answers with. */
interface Challenge {
  token: string;
  challenge: { c: number; s: number; d: number };
}

/** What /api/cap/:scope/redeem answers with. */
interface Redeemed {
  success?: boolean;
  token?: string;
}

/**
 * Cap, the proof-of-work gate in front of signup and password reset (#98).
 *
 * The browser side (widget, Web Worker, WASM, CSP) is asserted in
 * tests/e2e/production/csp.pw.ts and exercised by every signup scenario,
 * because CAP_SECRET is set in .dev.vars.example. What is left for here is
 * the part a browser cannot show: that a forged, reused, or absent token is
 * refused, and that an unset secret disables the gate instead of breaking
 * the form.
 */

// capjs-core refuses a secret under 16 bytes, and refuses it by throwing
// inside the challenge route. That is fail-closed, which is the right way
// round for a security control, but it does mean a too-short CAP_SECRET
// takes signup down rather than quietly running unprotected.
const CAP_ON = () =>
  overrideEnv({
    BETTER_AUTH_SECRET: "test-secret",
    CAP_SECRET: "cap-test-secret-long-enough-to-be-accepted",
  });

function capPost(path: string, body: JsonValue, testEnv = CAP_ON()) {
  return fetchWorker(
    new Request(`http://localhost/api/cap/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    testEnv,
  );
}

/** Brute-forces one Cap challenge the way the browser's worker does: find a
 * nonce whose sha256(salt + nonce) starts with the target prefix. */
async function solve(salt: string, target: string): Promise<number> {
  for (let nonce = 0; ; nonce++) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + nonce));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex.startsWith(target)) return nonce;
  }
}

/**
 * Cap's salt/target derivation, copied because the package does not export
 * it. Salts are never sent: both sides derive them from the token, so a test
 * that wants to solve a real challenge has to derive them too.
 *
 * Copying it does couple this test to Cap's internals, which is why it is
 * only here and not in src: if they change the PRNG, redeem starts returning
 * 400 and these tests fail loudly rather than quietly testing nothing.
 */
function prng(seed: string, length: number): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  let state = hash >>> 0;
  let result = "";
  while (result.length < length) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    result += state.toString(16).padStart(8, "0");
  }
  return result.substring(0, length);
}

async function solveAll(token: string, spec: { c: number; s: number; d: number }) {
  const solutions: number[] = [];
  for (let i = 1; i <= spec.c; i++) {
    solutions.push(await solve(prng(`${token}${i}`, spec.s), prng(`${token}${i}d`, spec.d)));
  }
  return solutions;
}

function signUp(email: string, headers: Record<string, string> = {}, testEnv = CAP_ON()) {
  return fetchWorker(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email, password: "a-good-password-1", name: "probe" }),
    }),
    testEnv,
  );
}

beforeEach(async () => {
  reset();
  await applyTestMigrations();
  captureEmails({ mx: "deliverable" });
});

describe("issuing and redeeming", () => {
  it("mints a challenge, and redeems a correct solution for a token", async () => {
    const challenge = await jsonBody<Challenge>(await capPost("signup/challenge", {}));
    expect(challenge.challenge.c).toBeGreaterThan(0);

    const redeemed = await jsonBody<Redeemed>(
      await capPost("signup/redeem", {
        token: challenge.token,
        solutions: await solveAll(challenge.token, challenge.challenge),
      }),
    );

    expect(redeemed.success).toBe(true);
    expect(redeemed.token).toBeTruthy();
  });

  it("refuses a wrong solution", async () => {
    const challenge = await jsonBody<Challenge>(await capPost("signup/challenge", {}));
    const res = await capPost("signup/redeem", {
      token: challenge.token,
      solutions: Array.from({ length: challenge.challenge?.c ?? 12 }, () => 1),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a scope nobody offers", async () => {
    expect((await capPost("admin/challenge", {})).status).toBe(400);
  });
});

describe("spending a token at signup", () => {
  async function mintToken(scope = "signup") {
    const challenge = await jsonBody<Challenge>(await capPost(`${scope}/challenge`, {}));
    const redeemed = await jsonBody<Redeemed>(
      await capPost(`${scope}/redeem`, {
        token: challenge.token,
        solutions: await solveAll(challenge.token, challenge.challenge),
      }),
    );
    return redeemed.token;
  }

  it("accepts a freshly redeemed token", async () => {
    const res = await signUp("fresh@example.com", { "x-cap-token": await mintToken() });
    expect(res.status).toBe(200);
  });

  it("refuses the same token twice, so a harvested one is worth one attempt", async () => {
    const token = await mintToken();
    expect((await signUp("first@example.com", { "x-cap-token": token })).status).toBe(200);

    const replay = await signUp("second@example.com", { "x-cap-token": token });
    expect(replay.status).toBe(400);
    // And the second account was never created.
    const { results } = await env.DB.prepare("select email from user").all();
    expect(results.map((r) => r.email)).not.toContain("second@example.com");
  });

  it("accepts a token KV has never heard of", async () => {
    // The regression this guards: the redeemed token used to be a random
    // string written to KV at redeem and read back here. KV is eventually
    // consistent, so that read missed and real signups were told to prove
    // they were human again, forever. Emptying KV stands in for a write that
    // has not propagated; a signed token does not care.
    const token = await mintToken();
    for (const key of (await env.LINKS.list()).keys) await env.LINKS.delete(key.name);
    expect((await signUp("unpropagated@example.com", { "x-cap-token": token })).status).toBe(200);
  });

  it("refuses a missing token", async () => {
    expect((await signUp("notoken@example.com")).status).toBe(400);
  });

  it("refuses a forged token", async () => {
    const res = await signUp("forged@example.com", { "x-cap-token": "deadbeef:cafe" });
    expect(res.status).toBe(400);
  });

  it("refuses a token minted for another scope", async () => {
    // The whole point of binding a scope into the signature: a token earned
    // on the password-reset form must not open the signup door.
    const res = await signUp("crossed@example.com", {
      "x-cap-token": await mintToken("password-reset"),
    });
    expect(res.status).toBe(400);
  });
});

describe("with no CAP_SECRET", () => {
  // Explicitly cleared, not merely left out: the ambient binding is built
  // from .dev.vars, which now sets CAP_SECRET so the browser tests run the
  // real loop. Inheriting it here would test the enabled path twice and the
  // disabled path never.
  const CAP_OFF = () => overrideEnv({ BETTER_AUTH_SECRET: "test-secret", CAP_SECRET: undefined });

  // The matching signup case lives in cap-disabled.worker.ts: getAuth()
  // caches its instance per isolate, so the hook closes over whichever env
  // built it first. Harmless in production, where bindings never change,
  // but it means the disabled path needs a file of its own to be tested.

  it("reports the challenge endpoint as disabled rather than erroring", async () => {
    const res = await capPost("signup/challenge", {}, CAP_OFF());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disabled: true });
  });
});
