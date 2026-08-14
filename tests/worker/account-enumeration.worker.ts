import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import {
  applyTestMigrations,
  authEnv,
  captureEmails,
  fetchWorker,
  jsonBody,
  TEST_PASSWORD,
} from "./support";
import { hashPassword } from "../../src/worker/password";

/** Signup's MX lookup must succeed for the enumeration branches to be the
 * thing under test, so every domain looks deliverable here. */
const stubFetch = () => captureEmails({ mx: "deliverable" });

async function seedUser(email: string, emailVerified: boolean) {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('known-1','Known',?,?,0,'free',0,0)",
    ).bind(email, emailVerified ? 1 : 0),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-known','known-1','credential','known-1',?,0,0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
  ]);
}

function signUp(email: string) {
  return fetchWorker(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "a-different-password", name: "probe" }),
    }),
    authEnv(),
  );
}

function sendVerificationOtp(email: string) {
  return fetchWorker(
    new Request("http://localhost/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, type: "email-verification" }),
    }),
    authEnv(),
  );
}

/** The parts of a response an outsider can compare between two addresses. */
function shapeOf(body: Record<string, unknown>): unknown {
  const user = body.user as Record<string, unknown> | null;
  return {
    keys: Object.keys(body).sort(),
    token: body.token,
    userKeys: user ? Object.keys(user).sort() : null,
  };
}

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});
afterEach(reset);

describe("signup does not reveal which addresses have accounts (#53)", () => {
  it("answers a taken address with the same status and shape as a free one", async () => {
    await seedUser("known@gmail.com", true);
    const { restore } = stubFetch();

    try {
      const taken = await signUp("known@gmail.com");
      const fresh = await signUp("nobody@gmail.com");

      expect(taken.status).toBe(fresh.status);
      const takenBody = await jsonBody<Record<string, unknown>>(taken);
      const freshBody = await jsonBody<Record<string, unknown>>(fresh);
      expect(shapeOf(takenBody)).toEqual(shapeOf(freshBody));
    } finally {
      restore();
    }
  });

  it("answers before the notice goes out, so a taken address is no slower (#53)", async () => {
    await seedUser("known@gmail.com", true);

    // A Resend that never answers until this test says so. If the notice were
    // awaited inside the request, the response below could not arrive.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { started, restore } = captureEmails({ mx: "deliverable", hold: held });

    const ctx = createExecutionContext();
    try {
      const res = await worker.fetch(
        new Request("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "known@gmail.com",
            password: "a-different-password",
            name: "probe",
          }),
        }),
        authEnv(),
        ctx,
      );

      // The answer is here while the send is still hanging: the timing an
      // outsider can measure no longer depends on the address existing.
      expect(res.status).toBe(200);
      expect(started()).toBe(true);

      release();
      await waitOnExecutionContext(ctx);
    } finally {
      release();
      restore();
    }
  });

  it("creates no account and changes no password for the taken address", async () => {
    await seedUser("known@gmail.com", true);
    const [seeded] = await env.DB.prepare("select password from account where user_id = 'known-1'")
      .all<{ password: string }>()
      .then((r) => r.results);
    const storedPassword = seeded!.password;
    const { restore } = stubFetch();

    try {
      await signUp("known@gmail.com");
    } finally {
      restore();
    }

    const { results } = await env.DB.prepare("select id from user where email = ?")
      .bind("known@gmail.com")
      .all();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("known-1");

    // The password the prober typed must not have touched the real account.
    // Asserted on the stored hash rather than by attempting a sign-in: a
    // failed sign-in is the point, but it also raises inside better-auth and
    // shows up as an unhandled rejection in the run.
    const [account] = await env.DB.prepare("select password from account where user_id = 'known-1'")
      .all<{ password: string }>()
      .then((r) => r.results);
    expect(account!.password).toBe(storedPassword);
  });

  it("never returns the existing account's id", async () => {
    await seedUser("known@gmail.com", true);
    const { restore } = stubFetch();

    try {
      const body = await (await signUp("known@gmail.com")).text();
      expect(body).not.toContain("known-1");
    } finally {
      restore();
    }
  });

  it("tells the address's owner by email, with no code in it", async () => {
    await seedUser("known@gmail.com", true);
    const { sent, restore } = stubFetch();

    try {
      await signUp("known@gmail.com");
    } finally {
      restore();
    }

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("known@gmail.com");
    expect(sent[0]!.subject).toContain("tried to sign up");
    // A code here would be the takeover the old disguise caused: the reader
    // is not necessarily the person who typed the form. Checked on the text
    // part, where a code sits on a line of its own: the HTML part carries
    // hex colours, and "#262336" is six digits.
    expect((sent[0] as unknown as { text: string }).text).not.toMatch(/^\s*\d{6}\s*$/m);
  });

  it("mails nobody when the address is free", async () => {
    const { sent, restore } = stubFetch();

    try {
      await signUp("nobody@gmail.com");
    } finally {
      restore();
    }

    expect(sent).toHaveLength(0);
  });

  it("still refuses a domain that cannot receive mail, for taken and free alike", async () => {
    await seedUser("known@nomx.example", true);
    const { restore } = captureEmails({ mx: "unroutable" });

    try {
      const taken = await signUp("known@nomx.example");
      const fresh = await signUp("nobody@nomx.example");
      expect(taken.status).toBe(422);
      expect(fresh.status).toBe(422);
    } finally {
      restore();
    }
  });
});

describe("the verification-OTP send does not reveal verified addresses (#53)", () => {
  it("answers an already-verified address exactly as an unverified one", async () => {
    await seedUser("known@gmail.com", true);
    const { restore } = stubFetch();

    try {
      const verified = await sendVerificationOtp("known@gmail.com");
      expect(verified.status).toBe(200);
      expect(await verified.json()).toEqual({ success: true });
    } finally {
      restore();
    }
  });

  it("sends no code to an already-verified address", async () => {
    await seedUser("known@gmail.com", true);
    const { sent, restore } = stubFetch();

    try {
      await sendVerificationOtp("known@gmail.com");
    } finally {
      restore();
    }

    // Verification auto-signs-in, so a code here would hand a session to
    // whoever reads that inbox.
    expect(sent).toHaveLength(0);
  });

  it("still sends a code to an unverified address", async () => {
    await seedUser("known@gmail.com", false);
    const { sent, restore } = stubFetch();

    try {
      await sendVerificationOtp("known@gmail.com");
    } finally {
      restore();
    }

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("known@gmail.com");
  });
});
