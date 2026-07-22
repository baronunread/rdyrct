import { afterEach, describe, expect, test } from "bun:test";
import { api, ApiError, shortUrl } from "../src/app/lib/api";

(globalThis as { window?: unknown }).window = {
  location: { origin: "http://localhost:5173" },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(res: {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: res.ok,
      status: res.status ?? 200,
      statusText: res.statusText ?? "OK",
      json: res.json ?? (async () => ({})),
    } as Response;
  }) as typeof fetch;
  return calls;
}

describe("ApiError", () => {
  test("carries status, message and code", () => {
    const err = new ApiError(409, "Slug taken", "slug_taken");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.message).toBe("Slug taken");
    expect(err.code).toBe("slug_taken");
  });
});

describe("shortUrl", () => {
  test("uses the custom domain when given one", () => {
    expect(shortUrl("abc123", "go.brand.com")).toBe("https://go.brand.com/abc123");
  });

  test("falls back to the current origin", () => {
    expect(shortUrl("abc123")).toBe("http://localhost:5173/abc123");
    expect(shortUrl("abc123", null)).toBe("http://localhost:5173/abc123");
  });
});

describe("api", () => {
  test("prefixes /api and parses the JSON body", async () => {
    const calls = stubFetch({
      ok: true,
      json: async () => ({ hello: "world" }),
    });
    const data = await api<{ hello: string }>("/user");
    expect(calls[0].url).toBe("/api/user");
    expect(data.hello).toBe("world");
  });

  test("serializes a body and sets the JSON content type", async () => {
    const calls = stubFetch({ ok: true });
    await api("/links", { method: "POST", body: { slug: "abc" } });
    const call = calls[0]!;
    expect(call.init?.body).toBe(JSON.stringify({ slug: "abc" }));
    expect(call.init?.headers).toMatchObject({
      "content-type": "application/json",
    });
  });

  test("throws ApiError with the server's message and code", async () => {
    stubFetch({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ message: "Slug taken", code: "slug_taken" }),
    });
    const err = await api("/links", { method: "POST" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("Slug taken");
    expect(err.code).toBe("slug_taken");
  });

  test("falls back to statusText for non-JSON error bodies", async () => {
    stubFetch({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("not json");
      },
    });
    const err = await api("/boom").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe("Internal Server Error");
  });
});
