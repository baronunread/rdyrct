import { describe, expect, test } from "bun:test";
import { CAP_FAILED_CODE } from "@/shared/types";
import { isCapFailure, retryOnCapFailure } from "@/app/lib/cap-retry";

/**
 * The second go at a refused Cap token (#98).
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
    sent.push(headers["x-cap-token"] ?? "");
    const result = results[call++];
    if (result instanceof Error) throw result;
    return result;
  };
  let token = 0;
  const headers = async () => ({ "x-cap-token": `token-${++token}` });
  return { run, headers, sent };
}

describe("recognizing a refused token", () => {
  test("reads better-auth's returned error", () => {
    expect(isCapFailure({ error: { code: CAP_FAILED_CODE } })).toBe(true);
  });

  test("reads the thrown ApiError", () => {
    expect(isCapFailure(new ApiError(CAP_FAILED_CODE))).toBe(true);
  });

  test("leaves anything else alone", () => {
    expect(isCapFailure(new ApiError("slug_taken"))).toBe(false);
    expect(isCapFailure({ error: { code: "rate_limited" } })).toBe(false);
    expect(isCapFailure({ slug: "abc" })).toBe(false);
    expect(isCapFailure(null)).toBe(false);
  });
});

describe("running a Cap-guarded request", () => {
  test("passes the first answer through, with one token", async () => {
    const { run, headers, sent } = refusals({ slug: "abc" });

    expect(await retryOnCapFailure(run, headers)).toEqual({ slug: "abc" });
    expect(sent).toEqual(["token-1"]);
  });

  test("solves again when the token comes back thrown", async () => {
    const { run, headers, sent } = refusals(new ApiError(CAP_FAILED_CODE), { slug: "abc" });

    expect(await retryOnCapFailure(run, headers)).toEqual({ slug: "abc" });
    // A fresh token, not the one the server already spent.
    expect(sent).toEqual(["token-1", "token-2"]);
  });

  test("solves again when the token comes back returned", async () => {
    const { run, headers, sent } = refusals({ error: { code: CAP_FAILED_CODE } }, { slug: "abc" });

    expect(await retryOnCapFailure(run, headers)).toEqual({ slug: "abc" });
    expect(sent).toEqual(["token-1", "token-2"]);
  });

  test("raises anything that is not about the token, without a second attempt", async () => {
    const { run, headers, sent } = refusals(new ApiError("slug_taken"), { slug: "abc" });

    await expect(retryOnCapFailure(run, headers)).rejects.toThrow("slug_taken");
    expect(sent).toEqual(["token-1"]);
  });

  test("stops at two, so a real refusal reaches the screen", async () => {
    const refused = new ApiError(CAP_FAILED_CODE);
    const { run, headers, sent } = refusals(refused, refused, { slug: "abc" });

    await expect(retryOnCapFailure(run, headers)).rejects.toThrow(CAP_FAILED_CODE);
    expect(sent).toEqual(["token-1", "token-2"]);
  });
});
