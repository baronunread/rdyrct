import type { Context } from "hono";
import type { AppEnv } from "./env";
import { getAuth } from "./better-auth";
import { lookup } from "../shared/lookup";

/**
 * Dev-only scenarios: every account state one link away, against the real
 * Worker and the seeded database (`bun run db:seed:local`).
 *
 * `/__dev/scenarios` lists them. `/__dev/scenarios/<name>?to=/links` signs in
 * as the seeded account that is in that state, selects its org and opens the
 * page. Each scenario is a query rather than a fixed address, so it survives a
 * re-seed and always lands on a row that really is in that state.
 *
 * Two fences keep it out of anything real. index.ts imports it dynamically
 * and only under `import.meta.env.DEV`, a build-time constant, so a
 * production build carries none of this code (tests/e2e/production checks
 * the route is gone). And it signs in only as an `@seed.test` account, using
 * the seeder's shared password, so even a dev server pointed at real data
 * could not use it to become anybody else.
 */

const SEED_PASSWORD = "seed-password-123";

type Scenario = {
  title: string;
  about: string;
  /** Where to land when the link names no page. */
  start: string;
  /** Returns the account's email and the org to select. */
  sql: string;
};

const ownerOf = (where: string, order = "links DESC") => `
  SELECT u.email, o.id AS orgId,
    (SELECT count(*) FROM links l WHERE l.org_id = o.id) AS links
  FROM orgs o
  JOIN org_members m ON m.org_id = o.id AND m.role = 'owner'
  JOIN user u ON u.id = m.user_id
  WHERE u.email LIKE '%@seed.test' AND ${where}
  ORDER BY ${order} LIMIT 1`;

const notDowngraded = "o.id NOT IN (SELECT org_id FROM org_entitlements) AND o.locked_at IS NULL";

const SCENARIOS = {
  "pro-owner": {
    title: "Pro owner",
    about: "A busy Pro org: many links, members, a custom domain.",
    start: "/dashboard",
    sql: ownerOf(`u.plan = 'pro' AND ${notDowngraded}`),
  },
  "hobby-owner": {
    title: "Hobby owner",
    about: "A paid org on the smaller plan.",
    start: "/dashboard",
    sql: ownerOf(`u.plan = 'hobby' AND ${notDowngraded}`),
  },
  "free-owner": {
    title: "Free owner",
    about: "An ordinary free org with a handful of links.",
    start: "/dashboard",
    sql: ownerOf(
      `u.plan = 'free' AND ${notDowngraded} AND o.id LIKE 'seed-%' AND o.id NOT LIKE 'seed-scn-%'`,
    ),
  },
  fresh: {
    title: "Brand-new account",
    about: "Signed up a minute ago. No links, no clicks.",
    start: "/dashboard",
    sql: ownerOf("u.email = 'fresh.account@seed.test'"),
  },
  member: {
    title: "Member, not owner",
    about: "Belongs to a paid org as a member.",
    start: "/links",
    sql: `SELECT u.email, m.org_id AS orgId FROM org_members m JOIN user u ON u.id = m.user_id
      WHERE m.role = 'member' AND u.email LIKE '%@seed.test'
        AND m.org_id NOT IN (SELECT org_id FROM org_entitlements) LIMIT 1`,
  },
  viewer: {
    title: "Viewer",
    about: "Demoted to viewer by a downgrade: reads, cannot change.",
    start: "/links",
    sql: `SELECT u.email, m.org_id AS orgId FROM org_members m JOIN user u ON u.id = m.user_id
      WHERE m.role = 'viewer' AND u.email LIKE '%@seed.test' LIMIT 1`,
  },
  "over-plan": {
    title: "Over the plan, just downgraded",
    about: "Grace period running: links, members and a domain over Free.",
    start: "/dashboard",
    sql: ownerOf(
      "o.id IN (SELECT org_id FROM org_entitlements WHERE grace_ends_at > unixepoch() * 1000)",
      "(SELECT grace_ends_at FROM org_entitlements e WHERE e.org_id = o.id) DESC",
    ),
  },
  "grace-ended": {
    title: "Grace period over",
    about: "The custom domain has stopped serving.",
    start: "/domains",
    sql: ownerOf(
      "o.id IN (SELECT org_id FROM org_entitlements WHERE grace_ends_at <= unixepoch() * 1000)",
    ),
  },
  "locked-org": {
    title: "Read-only org",
    about: "An owner over the org cap, looking at the org that got locked.",
    start: "/dashboard",
    sql: ownerOf("o.locked_at IS NOT NULL"),
  },
  "click-cap": {
    title: "At the click cap",
    about: "A free org that has used this month's counted clicks.",
    start: "/billing",
    sql: `SELECT u.email, o.id AS orgId FROM org_click_usage c
      JOIN orgs o ON o.id = c.org_id
      JOIN org_members m ON m.org_id = o.id AND m.role = 'owner'
      JOIN user u ON u.id = m.user_id
      WHERE u.plan = 'free' AND u.email LIKE '%@seed.test' AND ${notDowngraded}
      ORDER BY c.month DESC, c.clicks DESC LIMIT 1`,
  },
  admin: {
    title: "Platform admin",
    about: "Sees the Platform section.",
    start: "/admin",
    sql: ownerOf("u.email = 'platform.admin@seed.test'"),
  },
} satisfies Record<string, Scenario>;

const PAGES = [
  "/dashboard",
  "/analytics",
  "/links",
  "/domains",
  "/members",
  "/organization",
  "/api-keys",
  "/billing",
  "/settings",
];

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

function indexPage(): string {
  const rows = Object.entries(SCENARIOS)
    .map(
      ([key, s]) =>
        `<li><a href="/__dev/scenarios/${key}"><b>${esc(s.title)}</b></a> <span>${esc(s.about)}</span><br>${PAGES.map(
          (p) =>
            `<a class="p" href="/__dev/scenarios/${key}?to=${encodeURIComponent(p)}">${p.slice(1)}</a>`,
        ).join(" ")}</li>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Dev scenarios</title>
<style>body{font:15px/1.5 system-ui;margin:40px auto;max-width:760px;padding:0 20px;background:#f7f4ef;color:#2a2733}
li{margin:0 0 18px}span{color:#544f61}a{color:#745ab8}.p{font-size:13px;margin-right:8px}code{font-size:13px}</style>
<h1>Dev scenarios</h1><p>Signs in as a seeded account in that state. Needs <code>bun run db:seed:local</code>. Dev builds only.</p><ul>${rows}</ul>`;
}

/**
 * Answers every /__dev request. index.ts calls it with its own context, so the
 * request carries the app's wide event (evlog's include list names /__dev,
 * which only exists in a dev build).
 */
export async function handleDev(c: Context<AppEnv>): Promise<Response> {
  const log = c.get("log");
  const path = new URL(c.req.url).pathname;
  log?.set({ route: path });
  if (c.req.method === "GET" && path === "/__dev/scenarios") return c.html(indexPage());
  const name = /^\/__dev\/scenarios\/([a-z-]+)$/.exec(path)?.[1];
  if (c.req.method === "GET" && name) return signInAs(c, name);
  return c.text("Not found", 404);
}

async function signInAs(c: Context<AppEnv>, name: string): Promise<Response> {
  c.get("log")?.set({ scenario: { name } });
  const scenario: Scenario | undefined = lookup(SCENARIOS, name);
  if (!scenario) return c.text(`No scenario "${name}". See /__dev/scenarios`, 404);

  const row = await c.env.DB.prepare(scenario.sql).first<{ email: string; orgId: string }>();
  if (!row)
    return c.text(`No seeded account is in the "${name}" state. Run bun run db:seed:local.`, 409);
  if (!row.email.endsWith("@seed.test"))
    return c.text("Scenarios only sign in as seeded accounts.", 403);

  const signIn = await getAuth(c.env).api.signInEmail({
    body: { email: row.email, password: SEED_PASSWORD },
    asResponse: true,
  });
  if (!signIn.ok) return c.text(`Could not sign in as ${row.email}: ${signIn.status}`, 502);

  const res = new Response(hopPage(scenario, row, landing(c.req.query("to"), scenario)), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  for (const cookie of signIn.headers.getSetCookie()) res.headers.append("set-cookie", cookie);
  return res;
}

/** Where the hop lands: an app path asked for, or the scenario's own start.
 * Only plain paths: no backslash, no second slash at the start, nothing that
 * could leave the site or end the script it is written into. */
function landing(to: string | undefined, scenario: Scenario): string {
  return to && /^\/[a-z0-9/_?=&.-]*$/i.test(to) && !to.startsWith("//") ? to : scenario.start;
}

/** A value written into an inline script. JSON.stringify leaves "<" alone,
 * so "</script>" in a value would end the script early. */
const inScript = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");

/** The current org and the cookie banner live in localStorage, so the hop
 * goes through a page that sets both before it opens the app. The cached
 * /user is cleared so the shell paints the new account, not the last one. */
function hopPage(scenario: Scenario, row: { email: string; orgId: string }, target: string) {
  return `<!doctype html><meta charset="utf-8"><title>${esc(scenario.title)}</title><script>
localStorage.setItem("rdyrct:currentOrg", ${inScript(row.orgId)});
localStorage.setItem("rdyrct:consent:v2", "rejected");
localStorage.setItem("rdyrct:consent:v2:at", String(Date.now()));
localStorage.removeItem("rdyrct:user:v1");
location.replace(${inScript(target)});
</script>Signing in as ${esc(row.email)}…`;
}
