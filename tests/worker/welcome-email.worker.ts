import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  authEnv,
  overrideEnv,
  captureEmails,
  type CapturedEmail,
  fetchWorker,
  signInCookie,
  TEST_PASSWORD,
} from "./support";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import { sendWelcomeOnce } from "../../src/worker/welcome";
import { hashPassword } from "../../src/worker/password";
import type { JsonValue } from "../../src/shared/types";

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

const post = (path: string, body: JsonValue, cookie?: string) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) {
    headers.set("cookie", cookie);
    headers.set("origin", authEnv().APP_URL);
  }
  return fetchWorker(
    new Request(`http://localhost/api/auth/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    authEnv(),
  );
};

const welcomes = (sent: CapturedEmail[]) => sent.filter((m) => m.subject === "Welcome to rdyrct");

describe("welcome email", () => {
  it("goes out when a new account verifies its address, and says nothing before", async () => {
    const mail = captureEmails({ mx: "deliverable" });
    const email = "newcomer@example.com";
    await post("sign-up/email", { email, password: "a-good-password-1", name: "New" });
    await post("email-otp/send-verification-otp", { email, type: "email-verification" });
    expect(welcomes(mail.sent)).toHaveLength(0);

    const code = mail.sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0] ?? "";
    expect(code).not.toBe("");
    const res = await post("email-otp/verify-email", { email, otp: code });
    expect(res.status).toBe(200);

    const [welcome] = welcomes(mail.sent);
    expect(welcome?.to).toBe(email);
    // From a person, so a reply reaches that person.
    expect(welcome?.from).toBe("Andrea at rdyrct <andrea@mail.rdyrct.com>");
    expect(welcome?.text).toContain("/dashboard");
    // A letter to someone who just signed up: no "Not you?" boilerplate.
    expect(welcome?.text).not.toContain("Not you?");
    mail.restore();
  });

  it("goes out once, however many times the account is updated afterwards", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('u1','Old','old@example.com',1,0,'free',0,0)",
      ),
      env.DB.prepare(
        "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('a1','u1','credential','u1',?,0,0)",
      ).bind(await hashPassword(TEST_PASSWORD)),
    ]);
    const cookie = await signInCookie("old@example.com", TEST_PASSWORD);
    const mail = captureEmails();

    await post("update-user", { name: "One" }, cookie);
    await post("update-user", { name: "Two" }, cookie);

    expect(welcomes(mail.sent)).toHaveLength(1);
    mail.restore();
  });

  it("is not sent to an account that was already verified when the column arrived", async () => {
    // The migration marks every verified account as welcomed; reproduce its
    // effect on a row and show the next update stays quiet.
    await env.DB.batch([
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, welcome_sent_at, created_at, updated_at) values ('u2','Veteran','vet@example.com',1,0,'free',1,0,0)",
      ),
      env.DB.prepare(
        "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('a2','u2','credential','u2',?,0,0)",
      ).bind(await hashPassword(TEST_PASSWORD)),
    ]);
    const cookie = await signInCookie("vet@example.com", TEST_PASSWORD);
    const mail = captureEmails();

    await post("update-user", { name: "Renamed" }, cookie);

    expect(welcomes(mail.sent)).toHaveLength(0);
    mail.restore();
  });

  it("sends nothing, and claims nothing, where no founder sender is configured", async () => {
    await env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('u3','Fork','fork@example.com',1,0,'free',0,0)",
    ).run();
    const mail = captureEmails();

    await sendWelcomeOnce(overrideEnv({ WELCOME_FROM: undefined }), drizzle(env.DB, { schema }), {
      id: "u3",
      email: "fork@example.com",
      emailVerified: true,
    });

    expect(mail.sent).toEqual([]);
    const row = await env.DB.prepare("select welcome_sent_at from user where id = 'u3'").first();
    expect(row?.welcome_sent_at).toBeNull();
    mail.restore();
  });
});
