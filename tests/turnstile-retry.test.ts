import { describe, expect, test } from "bun:test";
import { TURNSTILE_FAILED_CODE } from "@/shared/types";
import { isTurnstileFailure, retryOnTurnstileFailure } from "@/app/lib/turnstile-retry";

/**
 * The second go at a refused Turnstile token (#304).
 *
 * A token is single use and short lived, so a refusal is routine: it expired,
 * the server already burned it, or it forgot it. The visitor did none of that
 * and should never read about it, so the request re-solves and runs once more.
 *
 * The bug this covers: the check only ever read a *returned* `{ error }`,
 * which is better-auth's shape. api() rejects instead, so the retry was dead
 * code on every route that used it, and the anonymous shortener showed "could
 * not verify you are human" to somebody shortening a second link.
 */

class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function refusals(...results: unknown[]) {
  const sent: string[] = [];
  let call = 0;
  const run = async (headers: Record<string, string>) => {
    sent.push(headers["x-turnstile-token"] ?? "");
    const result = results[call++];
    if (result instanceof Error) throw result;
    return result;
  };
  let token = 0;
  const headers = async () => ({ "x-turnstile-token": `token-${++token}` });
  return { run, headers, sent };
}

describe("recognizing a refused token", () => {
  test("reads better-auth's returned error", () => {
    expect(isTurnstileFailure({ error: { code: TURNSTILE_FAILED_CODE } })).toBe(true);
  });

  test("reads the thrown ApiError", () => {
    expect(isTurnstileFailure(new ApiError(TURNSTILE_FAILED_CODE))).toBe(true);
  });

  test("leaves anything else alone", () => {
    expect(isTurnstileFailure(new ApiError("slug_taken"))).toBe(false);
    expect(isTurnstileFailure({ error: { code: "rate_limited" } })).toBe(false);
    expect(isTurnstileFailure({ slug: "abc" })).toBe(false);
    expect(isTurnstileFailure(null)).toBe(false);
  });
});

describe("running a Turnstile-guarded request", () => {
  test("passes the first answer through, with one token", async () => {
    const { run, headers, sent } = refusals({ slug: "abc" });

    expect(await retryOnTurnstileFailure(run, headers)).toEqual({ slug: "abc" });
    expect(sent).toEqual(["token-1"]);
  });

  test("solves again when the token comes back thrown", async () => {
    const { run, headers, sent } = refusals(new ApiError(TURNSTILE_FAILED_CODE), { slug: "abc" });

    expect(await retryOnTurnstileFailure(run, headers)).toEqual({ slug: "abc" });
    // A fresh token, not the one the server already spent.
    expect(sent).toEqual(["token-1", "token-2"]);
  });

  test("solves again when the token comes back returned", async () => {
    const { run, headers, sent } = refusals(
      { error: { code: TURNSTILE_FAILED_CODE } },
      { slug: "abc" },
    );

    expect(await retryOnTurnstileFailure(run, headers)).toEqual({ slug: "abc" });
    expect(sent).toEqual(["token-1", "token-2"]);
  });

  test("raises anything that is not about the token, without a second attempt", async () => {
    const { run, headers, sent } = refusals(new ApiError("slug_taken"), { slug: "abc" });

    await expect(retryOnTurnstileFailure(run, headers)).rejects.toThrow("slug_taken");
    expect(sent).toEqual(["token-1"]);
  });

  test("stops at two, so a real refusal reaches the screen", async () => {
    const refused = new ApiError(TURNSTILE_FAILED_CODE);
    const { run, headers, sent } = refusals(refused, refused, { slug: "abc" });

    await expect(retryOnTurnstileFailure(run, headers)).rejects.toThrow(TURNSTILE_FAILED_CODE);
    expect(sent).toEqual(["token-1", "token-2"]);
  });
});
