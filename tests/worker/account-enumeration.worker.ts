import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, authEnv, fetchWorker, TEST_PASSWORD } from "./support";
import { hashPassword } from "../../src/worker/password";

/**
 * Captures Resend sends and answers the MX lookup signup does, so a test
 * decides what exists rather than the network. sendEmail() and
 * domainHasMailRecords() both use plain fetch, which makes the global the
 * one seam that covers them.
 */
function stubFetch(): {
  sent: { to: string; subject: string; text: string }[];
  restore: () => void;
} {
  const sent: { to: string; subject: string; text: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/emails")) {
      sent.push(
        JSON.parse(String(init?.body ?? "{}")) as { to: string; subject: string; text: string },
      );
      return Response.json({ id: "sent" });
    }
    if (url.includes("cloudflare-dns.com")) {
      return Response.json({ Status: 0, Answer: [{ data: "10 mx.example." }] });
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = original) };
}

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
      const takenBody = (await taken.json()) as Record<string, unknown>;
      const freshBody = (await fresh.json()) as Record<string, unknown>;
      expect(shapeOf(takenBody)).toEqual(shapeOf(freshBody));
    } finally {
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
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("cloudflare-dns.com")) return Response.json({ Status: 0, Answer: [] });
      if (url.includes("/emails")) return Response.json({ id: "sent" });
      return original(input as RequestInfo, init);
    }) as typeof fetch;

    try {
      const taken = await signUp("known@nomx.example");
      const fresh = await signUp("nobody@nomx.example");
      expect(taken.status).toBe(422);
      expect(fresh.status).toBe(422);
    } finally {
      globalThis.fetch = original;
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
