/**
 * Seed the LOCAL dev environment with fake orgs, members, links and clicks.
 *
 * Talks only to the local Explorer API (http://localhost:5173), so it can
 * never touch remote D1/KV. Run the dev server first, then:
 *
 *   bun scripts/seed-local.ts           # wipe previous seed data, re-seed
 *   bun scripts/seed-local.ts --wipe    # only remove seed data
 *
 * Every seeded row carries a "seed-" id prefix and every seeded user email
 * ends in @seed.test, so re-runs are idempotent. All seeded users share the
 * password below and have verified emails, so you can log in as any of them.
 */

const API = "http://localhost:5173/cdn-cgi/explorer/api";
const PASSWORD = "seed-password-123";

const CONFIG = {
  orgs: 10,
  extraUsersPool: 28, // non-owner users to spread across orgs as members
  clickDays: 120, // how far back click history goes
};

/* ---------------- deterministic PRNG (stable re-runs) ---------------- */

let rngState = 0xc0ffee;
function rand(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
/** Weighted pick: [value, weight] pairs. */
function pickW<T>(pairs: readonly (readonly [T, number])[]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

const ID_ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const randomFrom = (alphabet: string, len: number) => {
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
};
const uid = () => `seed-${randomFrom(ID_ALPHABET, 12)}`;
const randomSlug = () => randomFrom(SLUG_ALPHABET, 7);

/* ---------------- Explorer API helpers ---------------- */

async function apiJson(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, init);
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.success === false)) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} failed (${res.status}): ${JSON.stringify(body?.errors ?? body).slice(0, 500)}`,
    );
  }
  return body;
}

let DB_ID = "";
let KV_ID = "";

async function sql(query: string, params: unknown[] = []): Promise<any[]> {
  const body = await apiJson(`/d1/database/${DB_ID}/raw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: query, params }),
  });
  const r = body.result[0];
  const { columns, rows } = r.results ?? { columns: [], rows: [] };
  return rows.map((row: unknown[]) =>
    Object.fromEntries(columns.map((c: string, i: number) => [c, row[i]])),
  );
}

async function sqlBatch(statements: string[]): Promise<void> {
  await apiJson(`/d1/database/${DB_ID}/raw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ batch: statements.map((s) => ({ sql: s })) }),
  });
}

async function kvPut(key: string, value: unknown): Promise<void> {
  await apiJson(
    `/storage/kv/namespaces/${KV_ID}/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: JSON.stringify(value),
    },
  );
}

async function kvDelete(key: string): Promise<void> {
  await fetch(
    `${API}/storage/kv/namespaces/${KV_ID}/values/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
}

/** SQL string literal (all inputs come from the pools below, none user-supplied). */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/* ---------------- password hash (mirrors src/worker/password.ts) ---------------- */

async function hashPassword(password: string): Promise<string> {
  const iterations = 100_000;
  const salt = new Uint8Array(16);
  for (let i = 0; i < 16; i++) salt[i] = Math.floor(rand() * 256);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  const b64 = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `pbkdf2:${iterations}:${b64(salt.buffer)}:${b64(hash)}`;
}

/* ---------------- data pools ---------------- */

const ORG_NAMES = [
  "Nimbus Labs", "Cactus Coffee", "Orbit Fitness", "Paper Trail Co",
  "Bluegill Media", "Tundra Analytics", "Hearth & Home", "Velo Cycles",
  "Sundial Travel", "Copper Kettle", "Moss Studio", "Lighthouse Legal",
];
const FIRST = ["Ana", "Bruno", "Carla", "Dario", "Elena", "Franco", "Gina",
  "Hugo", "Irene", "Jonas", "Kira", "Luca", "Mara", "Nico", "Olga", "Paolo",
  "Rita", "Sami", "Tessa", "Ugo", "Vera", "Wanda", "Yuri", "Zoe"];
const LAST = ["Rossi", "Kim", "Novak", "Silva", "Meyer", "Costa", "Haas",
  "Lund", "Mori", "Pace", "Reyes", "Sato", "Toth", "Vidal", "Weiss", "Zana"];

const DESTINATIONS: readonly (readonly [string, string])[] = [
  ["https://example.com/spring-sale", "Spring sale"],
  ["https://example.com/pricing", "Pricing page"],
  ["https://example.com/blog/launch", "Launch post"],
  ["https://example.com/docs/getting-started", "Getting started"],
  ["https://example.com/careers", "Careers"],
  ["https://example.com/webinar/signup", "Webinar signup"],
  ["https://example.com/menu", "Menu"],
  ["https://example.com/newsletter", "Newsletter"],
  ["https://example.com/event/meetup", "Meetup"],
  ["https://example.com/store", "Store"],
  ["https://example.com/app/download", "App download"],
  ["https://example.com/survey", "Customer survey"],
];
const UTM_SOURCES = ["newsletter", "twitter", "linkedin", "print", "qr", ""];
const UTM_MEDIUMS = ["email", "social", "offline", "cpc", ""];
const CAMPAIGNS = ["spring-2026", "launch", "always-on", "summer-promo", ""];

const COUNTRIES: readonly (readonly [string, number])[] = [
  ["US", 30], ["IT", 18], ["DE", 12], ["GB", 10], ["FR", 8], ["ES", 6],
  ["BR", 5], ["NL", 4], ["JP", 3], ["IN", 3], ["CA", 3], ["AU", 2], ["", 2],
];
const REFERRERS: readonly (readonly [string, number])[] = [
  ["", 40], ["google.com", 20], ["t.co", 10], ["linkedin.com", 9],
  ["facebook.com", 7], ["news.ycombinator.com", 4], ["instagram.com", 4],
  ["reddit.com", 3], ["duckduckgo.com", 3],
];
const DEVICES: readonly (readonly [string, number])[] = [
  ["mobile", 48], ["desktop", 42], ["tablet", 6], ["bot", 4],
];

/* ---------------- wipe previous seed data ---------------- */

async function wipe(): Promise<number> {
  const links = await sql(
    "SELECT slug, domain_id FROM links WHERE id LIKE 'seed-%'",
  );
  const domains = await sql(
    "SELECT hostname FROM domains WHERE id LIKE 'seed-%'",
  );
  const hostById = new Map(
    (
      await sql("SELECT id, hostname FROM domains WHERE id LIKE 'seed-%'")
    ).map((d) => [d.id, d.hostname]),
  );
  for (const l of links) {
    const host = l.domain_id ? hostById.get(l.domain_id) : null;
    await kvDelete(host ? `slug:${host}:${l.slug}` : `slug:${l.slug}`);
  }
  for (const d of domains) await kvDelete(`domain:${d.hostname}`);

  // Explicit order instead of trusting cascades.
  await sqlBatch([
    "DELETE FROM clicks WHERE org_id LIKE 'seed-%'",
    "DELETE FROM links WHERE id LIKE 'seed-%'",
    "DELETE FROM domains WHERE id LIKE 'seed-%'",
    "DELETE FROM invites WHERE org_id LIKE 'seed-%'",
    "DELETE FROM org_members WHERE org_id LIKE 'seed-%'",
    "DELETE FROM orgs WHERE id LIKE 'seed-%'",
    "DELETE FROM session WHERE user_id LIKE 'seed-%'",
    "DELETE FROM account WHERE user_id LIKE 'seed-%'",
    "DELETE FROM user WHERE id LIKE 'seed-%'",
  ]);
  return links.length;
}

/* ---------------- seed ---------------- */

interface SeedUser {
  id: string;
  name: string;
  email: string;
  plan: "free" | "hobby" | "pro";
  createdAt: number;
}

async function seed() {
  const now = Date.now();
  const day = 86_400_000;
  const passwordHash = await hashPassword(PASSWORD);

  /* users: one owner per org + a shared pool of members */
  const users: SeedUser[] = [];
  const emailSeen = new Set<string>();
  const makeUser = (plan: SeedUser["plan"]): SeedUser => {
    let name = "", email = "";
    do {
      name = `${pick(FIRST)} ${pick(LAST)}`;
      email = `${name.toLowerCase().replace(" ", ".")}@seed.test`;
    } while (emailSeen.has(email));
    emailSeen.add(email);
    const u: SeedUser = {
      id: uid(),
      name,
      email,
      plan,
      createdAt: now - randInt(5, 360) * day,
    };
    users.push(u);
    return u;
  };

  const ownerPlans: SeedUser["plan"][] = [
    "pro", "pro", "hobby", "hobby", "hobby", "free", "free", "free", "free", "free",
  ];
  const owners = ownerPlans.slice(0, CONFIG.orgs).map((p) => makeUser(p));
  const pool = Array.from({ length: CONFIG.extraUsersPool }, () =>
    makeUser("free"),
  );

  const userRows = users.map(
    (u) =>
      `(${q(u.id)}, ${q(u.name)}, ${q(u.email)}, 1, ${q(u.plan)}, ${u.createdAt}, ${u.createdAt})`,
  );
  const accountRows = users.map(
    (u) =>
      `(${q(`seed-acc-${u.id.slice(5)}`)}, ${q(u.id)}, 'credential', ${q(u.id)}, ${q(passwordHash)}, ${u.createdAt}, ${u.createdAt})`,
  );
  await sqlBatch([
    `INSERT INTO user (id, name, email, email_verified, plan, created_at, updated_at) VALUES ${userRows.join(",")}`,
    `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ${accountRows.join(",")}`,
  ]);

  /* orgs + members */
  const memberCap = { free: 3, hobby: 5, pro: 25 } as const;
  const linkRange = { free: [6, 28], hobby: [30, 110], pro: [60, 220] } as const;

  interface SeedOrg {
    id: string;
    name: string;
    plan: SeedUser["plan"];
    ownerId: string;
    createdAt: number;
    domain: { id: string; hostname: string } | null;
  }
  const orgs: SeedOrg[] = [];
  const orgStatements: string[] = [];

  for (let i = 0; i < CONFIG.orgs; i++) {
    const owner = owners[i];
    const org: SeedOrg = {
      id: uid(),
      name: ORG_NAMES[i],
      plan: owner.plan,
      ownerId: owner.id,
      createdAt: owner.createdAt + randInt(0, 3) * day,
      domain: null,
    };
    orgs.push(org);
    orgStatements.push(
      `INSERT INTO orgs (id, name, created_at) VALUES (${q(org.id)}, ${q(org.name)}, ${org.createdAt})`,
    );

    const memberRows = [
      `(${q(org.id)}, ${q(owner.id)}, 'owner', ${org.createdAt})`,
    ];
    const others = [...pool].sort(() => rand() - 0.5)
      .slice(0, randInt(1, memberCap[org.plan] - 1));
    for (const m of others) {
      const role = rand() < 0.3 ? "admin" : "member";
      memberRows.push(
        `(${q(org.id)}, ${q(m.id)}, ${q(role)}, ${org.createdAt + randInt(1, 40) * day})`,
      );
    }
    orgStatements.push(
      `INSERT INTO org_members (org_id, user_id, role, created_at) VALUES ${memberRows.join(",")}`,
    );

    /* one active custom domain for paid orgs (fake host, data only) */
    if (org.plan !== "free" && rand() < 0.7) {
      org.domain = {
        id: uid(),
        hostname: `go.${org.name.toLowerCase().replace(/[^a-z]+/g, "")}.test`,
      };
      orgStatements.push(
        `INSERT INTO domains (id, org_id, hostname, status, created_at) VALUES (${q(org.domain.id)}, ${q(org.id)}, ${q(org.domain.hostname)}, 'active', ${org.createdAt + 2 * day})`,
      );
    }
  }
  await sqlBatch(orgStatements);
  for (const org of orgs) {
    if (org.domain)
      await kvPut(`domain:${org.domain.hostname}`, {
        domainId: org.domain.id,
        orgId: org.id,
        rootRedirect: "",
      });
  }

  /* links + KV + clicks */
  interface SeedLink {
    id: string;
    org: SeedOrg;
    slug: string;
    host: string | null;
    url: string;
    createdAt: number;
    weight: number; // relative popularity
  }
  const links: SeedLink[] = [];
  const usedSlugs = new Set<string>();

  for (const org of orgs) {
    const [lo, hi] = linkRange[org.plan];
    const count = randInt(lo, hi);
    const memberIds = (
      await sql(
        `SELECT user_id FROM org_members WHERE org_id = ${q(org.id)}`,
      )
    ).map((r) => r.user_id as string);

    const rows: string[] = [];
    for (let i = 0; i < count; i++) {
      const onCustomDomain = org.domain !== null && rand() < 0.25;
      let slug = onCustomDomain && rand() < 0.6
        ? `${pick(["promo", "menu", "app", "event", "docs", "join", "sale"])}-${randomFrom(SLUG_ALPHABET, 3)}`
        : randomSlug();
      while (usedSlugs.has(slug)) slug = randomSlug();
      usedSlugs.add(slug);

      const [destBase, title] = pick(DESTINATIONS);
      const dest = `${destBase}?ref=${org.name.toLowerCase().split(" ")[0]}`;
      const utmSource = pick(UTM_SOURCES);
      const utmMedium = utmSource ? pick(UTM_MEDIUMS) : "";
      const utmCampaign = utmSource ? pick(CAMPAIGNS) : "";
      const createdAt =
        org.createdAt + randInt(0, Math.max(1, Math.floor((now - org.createdAt) / day) - 1)) * day;

      const link: SeedLink = {
        id: uid(),
        org,
        slug,
        host: onCustomDomain ? org.domain!.hostname : null,
        url: dest,
        createdAt,
        // Pareto-ish: a few hot links, a long tail, some dead ones.
        weight: rand() < 0.15 ? randInt(40, 100) : rand() < 0.75 ? randInt(1, 12) : 0,
      };
      links.push(link);
      rows.push(
        `(${q(link.id)}, ${q(org.id)}, ${link.host ? q(org.domain!.id) : "NULL"}, ${q(slug)}, ${q(dest)}, ${q(title)}, ${q(utmSource)}, ${q(utmMedium)}, ${q(utmCampaign)}, ${q(pick(memberIds))}, ${createdAt})`,
      );
    }
    for (let i = 0; i < rows.length; i += 50) {
      await sqlBatch([
        `INSERT INTO links (id, org_id, domain_id, slug, destination, title, utm_source, utm_medium, utm_campaign, created_by, created_at) VALUES ${rows.slice(i, i + 50).join(",")}`,
      ]);
    }
  }

  for (const link of links) {
    await kvPut(link.host ? `slug:${link.host}:${link.slug}` : `slug:${link.slug}`, {
      linkId: link.id,
      orgId: link.org.id,
      url: link.url,
    });
  }
  console.log(`  links published to KV: ${links.length}`);

  /* clicks: recency-weighted, weekday-aware history */
  let totalClicks = 0;
  const clickValues: string[] = [];
  for (const link of links) {
    if (link.weight === 0) continue;
    const ageDays = Math.min(
      CONFIG.clickDays,
      Math.max(1, Math.floor((now - link.createdAt) / day)),
    );
    const n = Math.min(1500, Math.round(link.weight * ageDays * (0.3 + rand())));
    for (let i = 0; i < n; i++) {
      // Bias toward recent days; quadratic pull toward "today".
      const back = Math.floor(Math.pow(rand(), 1.8) * ageDays);
      const ts = new Date(now - back * day);
      const dow = ts.getUTCDay();
      if ((dow === 0 || dow === 6) && rand() < 0.45) continue; // quieter weekends
      const t =
        ts.getTime() - ts.getTime() % day +
        pickW([[9, 2], [10, 3], [11, 3], [12, 2], [14, 3], [15, 3], [16, 2], [18, 1], [20, 1], [8, 1], [22, 1]] as const) * 3_600_000 +
        randInt(0, 3_599_999);
      clickValues.push(
        `(${q(link.id)}, ${q(link.org.id)}, ${Math.min(t, now)}, ${q(pickW(COUNTRIES))}, ${q(pickW(REFERRERS))}, ${q(pickW(DEVICES))})`,
      );
      totalClicks++;
    }
  }
  for (let i = 0; i < clickValues.length; i += 400) {
    await sqlBatch([
      `INSERT INTO clicks (link_id, org_id, ts, country, referrer, device) VALUES ${clickValues.slice(i, i + 400).join(",")}`,
    ]);
    if (i % 4000 === 0 && i > 0)
      console.log(`  clicks inserted: ${i}/${clickValues.length}`);
  }

  /* summary */
  console.log("\nSeeded:");
  console.log(`  users:  ${users.length} (password for all: ${PASSWORD})`);
  console.log(`  orgs:   ${orgs.length}`);
  console.log(`  links:  ${links.length}`);
  console.log(`  clicks: ${totalClicks}`);
  console.log("\nLog in as an owner:");
  for (const org of orgs)
    console.log(
      `  ${org.name.padEnd(16)} ${org.plan.padEnd(6)} ${owners[orgs.indexOf(org)].email}`,
    );
}

/* ---------------- main ---------------- */

const dbs = await apiJson("/d1/database");
DB_ID = dbs.result.find((d: any) => d.name === "DB")?.uuid;
const kvs = await apiJson("/storage/kv/namespaces");
KV_ID = kvs.result.find((n: any) => n.title === "LINKS")?.id;
if (!DB_ID || !KV_ID) {
  console.error("Could not find local DB/LINKS bindings. Is `bun run dev` running?");
  process.exit(1);
}

const removed = await wipe();
if (removed) console.log(`Wiped previous seed data (${removed} links).`);
if (process.argv.includes("--wipe")) {
  console.log("Done (wipe only).");
  process.exit(0);
}
await seed();
