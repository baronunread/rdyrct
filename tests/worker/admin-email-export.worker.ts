import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { adminCookie, applyTestMigrations, fetchWorker, freeOwnerCookie } from "./support";

beforeEach(applyTestMigrations);
afterEach(reset);

function exportEmails(cookie = "", query = "") {
  return fetchWorker(
    new Request(`http://localhost/api/admin/users/emails.csv${query}`, { headers: { cookie } }),
  );
}

describe("admin email export", () => {
  it("rejects anonymous visitors and non-admin users", async () => {
    expect((await exportEmails()).status).toBe(404);
    expect((await exportEmails(await freeOwnerCookie())).status).toBe(404);
  });

  it("exports every verified non-banned account, ignoring search and pagination", async () => {
    const cookie = await adminCookie();
    const emails = Array.from(
      { length: 55 },
      (_, i) => `contact-${String(i).padStart(2, "0")}@example.com`,
    );
    await env.DB.batch([
      ...emails.map((email, i) =>
        env.DB.prepare(
          "insert into user (id, name, email, email_verified, banned, created_at, updated_at) values (?, 'Contact', ?, 1, 0, 0, 0)",
        ).bind(`contact-${i}`, email),
      ),
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, banned, created_at, updated_at) values ('unverified', 'Unverified', 'unverified@example.com', 0, 0, 0, 0), ('banned', 'Banned', 'banned@example.com', 1, 1, 0, 0)",
      ),
    ]);
    const response = await exportEmails(cookie, "?search=missing&page=99&limit=1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain(
      'attachment; filename="rdyrct-verified-user-emails.csv"',
    );
    expect((await response.text()).split("\r\n")).toEqual([
      "email",
      "admin@example.com",
      ...emails,
    ]);
  });

  it("preserves import addresses and quotes CSV delimiters", async () => {
    const cookie = await adminCookie();
    await env.DB.batch([
      env.DB.prepare("update user set email = ? where id = 'admin-1'").bind("+tag@example.com"),
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, created_at, updated_at) values ('quoted', 'Quoted', ?, 1, 0, 0)",
      ).bind('"last,first"@example.com'),
    ]);
    expect(await (await exportEmails(cookie)).text()).toBe(
      'email\r\n"""last,first""@example.com"\r\n+tag@example.com',
    );
  });

  it("returns only the header when no accounts are verified", async () => {
    const cookie = await adminCookie();
    await env.DB.prepare("update user set email_verified = 0").run();
    expect(await (await exportEmails(cookie)).text()).toBe("email");
  });
});
