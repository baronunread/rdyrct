import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import type { Env } from "../../src/worker/env";
import type { JsonValue } from "../../src/shared/types";
import {
  applyTestMigrations,
  captureEmails,
  exhaustedLimit,
  fetchWorker,
  openLimit,
  overrideEnv,
} from "./support";

const CODE = "STAY20";

/** The offer on, Turnstile off, and mail sent to the stand-in Resend. */
const offerEnv = (overrides: Partial<Env> = {}): Env =>
  overrideEnv({
    EXIT_OFFER_CODE: CODE,
    TURNSTILE_SECRET_KEY: undefined,
    TURNSTILE_SITE_KEY: undefined,
    RESEND_API_KEY: "re_test",
    RESEND_BASE_URL: "https://resend.test",
    RL_ANON_LINK: openLimit(),
    ...overrides,
  });

/** The popup's request. */
function requestCode(body: JsonValue, testEnv = offerEnv()) {
  return fetchWorker(
    new Request("http://localhost/api/exit-offer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    testEnv,
  );
}

/** The keys the endpoint has written: one per address, none in clear. */
async function rememberedKeys() {
  const { keys } = await env.LINKS.list({ prefix: "exit-offer:" });
  return keys.map((key) => key.name);
}

beforeEach(async () => {
  await applyTestMigrations();
});

afterEach(async () => {
  await reset();
});

describe("POST /api/exit-offer", () => {
  it("emails the code, with a link to the plans and no unsubscribe", async () => {
    const mail = captureEmails();
    const res = await requestCode({ email: "  Visitor@Example.com " });
    mail.restore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(mail.sent).toHaveLength(1);
    const [email] = mail.sent;
    expect(email?.to).toBe("Visitor@Example.com");
    expect(email?.subject).toBe("Your 20% off rdyrct");
    expect(email?.text).toContain(CODE);
    expect(email?.text).toContain("Use this code at checkout for 20% off");
    expect(email?.text).toContain(`${env.APP_URL}/pricing`);
    expect(email?.text).toContain("Works on a new Hobby or Pro subscription.");
    expect(email?.html).toContain(CODE);
    // Asked for by the visitor: transactional, so no unsubscribe link.
    expect(email?.text).not.toMatch(/unsubscribe/i);
    const keys = await rememberedKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toMatch(/visitor|example/i);
  });

  it("sends one email per address in 30 days, with the same answer each time", async () => {
    const mail = captureEmails();
    await requestCode({ email: "visitor@example.com" });
    const again = await requestCode({ email: "VISITOR@example.com " });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ sent: true });
    expect(mail.sent).toHaveLength(1);
    // Another address is its own.
    await requestCode({ email: "other@example.com" });
    mail.restore();
    expect(mail.sent.map((e) => e.to)).toEqual(["visitor@example.com", "other@example.com"]);
    expect(await rememberedKeys()).toHaveLength(2);
  });

  it("asks again once the 30 days are up", async () => {
    const mail = captureEmails();
    await requestCode({ email: "visitor@example.com" });
    // KV forgets the address when its TTL runs out; deleting it does the same.
    const [key] = await rememberedKeys();
    await env.LINKS.delete(key ?? "");
    await requestCode({ email: "visitor@example.com" });
    mail.restore();
    expect(mail.sent).toHaveLength(2);
  });

  it("needs Turnstile when the check is on", async () => {
    const mail = captureEmails();
    const guarded = offerEnv({
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    });
    const res = await requestCode({ email: "visitor@example.com" }, guarded);
    mail.restore();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "TURNSTILE_FAILED" });
    expect(mail.sent).toHaveLength(0);
    expect(await rememberedKeys()).toHaveLength(0);
  });

  it("refuses a bad address and a caller over its limit, sending nothing", async () => {
    const mail = captureEmails();
    expect((await requestCode({ email: "not-an-email" })).status).toBe(400);
    const limited = offerEnv({ RL_ANON_LINK: exhaustedLimit() });
    expect((await requestCode({ email: "visitor@example.com" }, limited)).status).toBe(429);
    mail.restore();
    expect(mail.sent).toHaveLength(0);
  });

  it("does not exist without EXIT_OFFER_CODE, and /api/config says so", async () => {
    const off = offerEnv({ EXIT_OFFER_CODE: undefined });
    expect((await requestCode({ email: "visitor@example.com" }, off)).status).toBe(404);
    const config = await fetchWorker(new Request("http://localhost/api/config"), off);
    expect(await config.json()).toMatchObject({ exitOfferCode: null });
    const on = await fetchWorker(new Request("http://localhost/api/config"), offerEnv());
    expect(await on.json()).toMatchObject({ exitOfferCode: "STAY20" });
  });
});
