import { beforeEach, describe, expect, test } from "bun:test";
import {
  publishDomain,
  publishLink,
  resolveDomain,
  resolveSlug,
  unpublishDomain,
  unpublishLink,
} from "../src/worker/kv";
import type { Env } from "../src/worker/env";

/** Minimal in-memory stand-in for the LINKS KV namespace. */
function mockKV() {
  const store = new Map<string, string>();
  return {
    store,
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async get(key: string, type?: string) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

let kv: ReturnType<typeof mockKV>;
let env: Env;

const LINK = {
  id: "link1",
  orgId: "org1",
  slug: "abc123",
  destination: "https://example.com/landing",
  utmSource: "newsletter",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
};

beforeEach(() => {
  kv = mockKV();
  env = { LINKS: kv } as unknown as Env;
});

describe("link publishing", () => {
  test("publishes and resolves a link on the shared host", async () => {
    await publishLink(env, LINK, null);
    expect(kv.store.has("slug:abc123")).toBe(true);

    const resolved = await resolveSlug(env, "abc123", null);
    expect(resolved).toEqual({
      linkId: "link1",
      orgId: "org1",
      url: "https://example.com/landing?utm_source=newsletter",
    });
  });

  test("custom-domain links are namespaced by hostname", async () => {
    await publishLink(env, LINK, "go.brand.com");
    expect(kv.store.has("slug:go.brand.com:abc123")).toBe(true);
    expect(kv.store.has("slug:abc123")).toBe(false);

    expect(await resolveSlug(env, "abc123", "go.brand.com")).not.toBeNull();
    expect(await resolveSlug(env, "abc123", null)).toBeNull();
  });

  test("unpublish removes the key", async () => {
    await publishLink(env, LINK, null);
    await unpublishLink(env, "abc123", null);
    expect(await resolveSlug(env, "abc123", null)).toBeNull();
  });

  test("resolving an unknown slug returns null", async () => {
    expect(await resolveSlug(env, "nope", null)).toBeNull();
  });
});

describe("domain publishing", () => {
  test("publishes and resolves a custom domain", async () => {
    await publishDomain(env, {
      id: "dom1",
      orgId: "org1",
      hostname: "go.brand.com",
      rootRedirect: "https://brand.com",
    });

    expect(await resolveDomain(env, "go.brand.com")).toEqual({
      domainId: "dom1",
      orgId: "org1",
      rootRedirect: "https://brand.com",
    });
  });

  test("unpublish removes the domain", async () => {
    await publishDomain(env, {
      id: "dom1",
      orgId: "org1",
      hostname: "go.brand.com",
      rootRedirect: "https://brand.com",
    });
    await unpublishDomain(env, "go.brand.com");
    expect(await resolveDomain(env, "go.brand.com")).toBeNull();
  });
});
