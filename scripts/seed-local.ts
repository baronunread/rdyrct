/**
 * Seeds the LOCAL dev environment through this checkout's Explorer API only, so it can never touch remote D1/KV.
 * Every seeded row has a `seed-` id prefix and every email ends in @seed.test, so re-runs are idempotent.
 */

import { ALIAS_TTL_MS } from "../src/worker/util";
import { PLAN_LIMITS, type JsonValue, type OverLimits } from "../src/shared/types";
import { defaultOrgName } from "../src/shared/org-name";
import { devHosts } from "./dev-hosts";

const API = `${(await devHosts()).app}/cdn-cgi/explorer/api`;
const PASSWORD = "seed-password-123";

const CONFIG = {
  orgs: 60,
  extraUsersPool: 220, // non-owner users to spread across orgs as members
  clickDays: 90, // how far back click history goes
};

let rngState = 0xc0ffee;
function rand(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
function pickW<T>(pairs: readonly (readonly [T, number])[]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const randomFrom = (alphabet: string, len: number) => {
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
};
const uid = () => `seed-${randomFrom(ID_ALPHABET, 12)}`;
const randomSlug = () => randomFrom(SLUG_ALPHABET, 7);

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

async function sql<Row = Record<string, string>>(
  query: string,
  params: unknown[] = [],
): Promise<Row[]> {
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

async function kvPut(key: string, value: JsonValue): Promise<void> {
  await apiJson(`/storage/kv/namespaces/${KV_ID}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: JSON.stringify(value),
  });
}

async function kvDelete(key: string): Promise<void> {
  await fetch(`${API}/storage/kv/namespaces/${KV_ID}/values/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

/** SQL string literal (all inputs come from the pools below, none user-supplied). */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

// Mirrors src/worker/password.ts.

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
  const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `pbkdf2:${iterations}:${b64(salt.buffer)}:${b64(hash)}`;
}

const ORG_NAME_PREFIX = [
  "Nimbus",
  "Cactus",
  "Orbit",
  "Paper Trail",
  "Bluegill",
  "Tundra",
  "Hearth",
  "Velo",
  "Sundial",
  "Copper Kettle",
  "Moss",
  "Lighthouse",
  "Granite",
  "Amber",
  "Cobalt",
  "Ember",
  "Willow",
  "Cedar",
  "Harbor",
  "Meridian",
  "Juniper",
  "Solace",
  "Anchor",
  "Foundry",
  "Marrow",
  "Thistle",
  "Vantage",
  "Wren",
  "Ashgrove",
  "Beacon",
];
const ORG_NAME_SUFFIX = [
  "Labs",
  "Coffee",
  "Fitness",
  "Co",
  "Media",
  "Analytics",
  "Home",
  "Cycles",
  "Travel",
  "Studio",
  "Legal",
  "Works",
  "Collective",
  "Group",
  "Partners",
  "Supply",
  "Kitchen",
  "Press",
  "Goods",
];
const usedOrgNames = new Set<string>();
function makeOrgName(): string {
  let name = "";
  // ORG_NAME_PREFIX x ORG_NAME_SUFFIX is finite: near CONFIG.orgs, fall back to a numbered suffix.
  for (let attempt = 0; attempt < 50; attempt++) {
    name = `${pick(ORG_NAME_PREFIX)} ${pick(ORG_NAME_SUFFIX)}`;
    if (!usedOrgNames.has(name)) break;
  }
  while (usedOrgNames.has(name)) name = `${name} ${usedOrgNames.size}`;
  usedOrgNames.add(name);
  return name;
}
const FIRST = [
  "Ana",
  "Bruno",
  "Carla",
  "Dario",
  "Elena",
  "Franco",
  "Gina",
  "Hugo",
  "Irene",
  "Jonas",
  "Kira",
  "Luca",
  "Mara",
  "Nico",
  "Olga",
  "Paolo",
  "Rita",
  "Sami",
  "Tessa",
  "Ugo",
  "Vera",
  "Wanda",
  "Yuri",
  "Zoe",
];
const LAST = [
  "Rossi",
  "Kim",
  "Novak",
  "Silva",
  "Meyer",
  "Costa",
  "Haas",
  "Lund",
  "Mori",
  "Pace",
  "Reyes",
  "Sato",
  "Toth",
  "Vidal",
  "Weiss",
  "Zana",
];

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

const COUNTRY_POOL = [
  "US",
  "CA",
  "MX",
  "BR",
  "AR",
  "CL",
  "CO",
  "PE",
  "GB",
  "IE",
  "FR",
  "DE",
  "NL",
  "BE",
  "ES",
  "PT",
  "IT",
  "CH",
  "AT",
  "SE",
  "NO",
  "DK",
  "FI",
  "PL",
  "CZ",
  "RO",
  "GR",
  "TR",
  "UA",
  "RU",
  "ZA",
  "NG",
  "KE",
  "EG",
  "MA",
  "AE",
  "SA",
  "IL",
  "IN",
  "PK",
  "BD",
  "CN",
  "JP",
  "KR",
  "TW",
  "HK",
  "SG",
  "MY",
  "ID",
  "TH",
  "VN",
  "PH",
  "AU",
  "NZ",
] as const;
function randomCountryMix(): (readonly [string, number])[] {
  const count = randInt(6, 12);
  const shuffled = [...COUNTRY_POOL].sort(() => rand() - 0.5).slice(0, count);
  const mix = shuffled
    .map((code) => [code, rand() ** 2] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([code, w], i) => [code, Math.round(w * 100) / (i + 1)] as const);
  mix.push(["", 2]);
  return mix;
}
const REFERRERS: readonly (readonly [string, number])[] = [
  ["", 40],
  ["google.com", 20],
  ["t.co", 10],
  ["linkedin.com", 9],
  ["facebook.com", 7],
  ["news.ycombinator.com", 4],
  ["instagram.com", 4],
  ["reddit.com", 3],
  ["duckduckgo.com", 3],
];
const DEVICES: readonly (readonly [string, number])[] = [
  ["mobile", 48],
  ["desktop", 42],
  ["tablet", 6],
  ["bot", 4],
];

async function wipe(): Promise<number> {
  const links = await sql("SELECT slug, domain_id FROM links WHERE id LIKE 'seed-%'");
  const addresses = await sql(
    "SELECT slug, domain_id FROM link_addresses WHERE org_id LIKE 'seed-%'",
  );
  const domains = await sql("SELECT hostname FROM domains WHERE id LIKE 'seed-%'");
  const hostById = new Map(
    (await sql("SELECT id, hostname FROM domains WHERE id LIKE 'seed-%'")).map((d) => [
      d.id,
      d.hostname,
    ]),
  );
  for (const a of addresses) {
    const host = a.domain_id ? hostById.get(a.domain_id) : null;
    await kvDelete(host ? `slug:${host}:${a.slug}` : `slug:${a.slug}`);
  }
  for (const d of domains) await kvDelete(`domain:${d.hostname}`);

  // A seed domain can also be pointed at by real rows (a link added through the app). `domain_id` is NO ACTION,
  // so clear by domain as well as by `seed-` prefix, or the wipe fails on a foreign key.
  await sqlBatch([
    "DELETE FROM clicks WHERE org_id LIKE 'seed-%'",
    "DELETE FROM click_daily WHERE org_id LIKE 'seed-%'",
    "DELETE FROM click_daily_dims WHERE org_id LIKE 'seed-%'",
    "DELETE FROM click_hourly WHERE org_id LIKE 'seed-%'",
    "DELETE FROM org_click_usage WHERE org_id LIKE 'seed-%'",
    "DELETE FROM link_addresses WHERE org_id LIKE 'seed-%'",
    "DELETE FROM link_addresses WHERE domain_id IN (SELECT id FROM domains WHERE id LIKE 'seed-%')",
    "DELETE FROM links WHERE id LIKE 'seed-%'",
    "DELETE FROM links WHERE domain_id IN (SELECT id FROM domains WHERE id LIKE 'seed-%')",
    "DELETE FROM domains WHERE id LIKE 'seed-%'",
    "DELETE FROM invites WHERE org_id LIKE 'seed-%'",
    "DELETE FROM org_entitlements WHERE org_id LIKE 'seed-%'",
    "DELETE FROM org_members WHERE org_id LIKE 'seed-%'",
    "DELETE FROM orgs WHERE id LIKE 'seed-%'",
    "DELETE FROM admin_actions WHERE id LIKE 'seed-plan-%'",
    "DELETE FROM session WHERE user_id LIKE 'seed-%'",
    "DELETE FROM account WHERE user_id LIKE 'seed-%'",
    "DELETE FROM user WHERE id LIKE 'seed-%'",
  ]);
  return links.length;
}

/** The seed writes raw clicks past insertClicks, so it builds the rollups from migration 0042's own
 * INSERT ... SELECT statements, then checks they add up to the raw rows (#26). */
async function buildRollups(): Promise<void> {
  await sqlBatch(await rollupBackfill("org_id LIKE 'seed-%'"));

  // Retried once: one request scanning all four tables after the backfill made the local D1 answer 500.
  const total = async (query: string): Promise<number> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const [r] = await sql<{ n: number }>(query);
        return Number(r?.n ?? 0);
      } catch (error) {
        if (attempt === 1) throw error;
        await Bun.sleep(2_000);
      }
    }
  };
  const row = {
    raw: await total("select count(*) as n from clicks where org_id like 'seed-%'"),
    daily: await total(
      "select coalesce(sum(clicks), 0) as n from click_daily where org_id like 'seed-%'",
    ),
    hourly: await total(
      "select coalesce(sum(clicks), 0) as n from click_hourly where org_id like 'seed-%'",
    ),
    dims: await total(
      "select coalesce(sum(clicks), 0) as n from click_daily_dims where org_id like 'seed-%' and dim = 'country'",
    ),
  };
  if (new Set(Object.values(row)).size !== 1) {
    throw new Error(
      `click rollups disagree with raw clicks: ${JSON.stringify(row)}. Restart bun run dev (it applies the migrations) and seed again.`,
    );
  }
  console.log(`  rollups built, matching ${row.raw} raw clicks`);
}

/** Its first `WHERE true` is the one that reads `clicks`. */
async function rollupBackfill(where: string): Promise<string[]> {
  const migration = await Bun.file(
    new URL("../migrations/0042_click_rollups.sql", import.meta.url),
  ).text();
  const backfill = migration
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .filter((q) => /INSERT INTO click_\w+.*SELECT/s.test(q))
    .map((q) => q.replace("WHERE true", `WHERE ${where}`));
  if (backfill.length !== 3) throw new Error("migration 0042 no longer has its three backfills");
  return backfill;
}

interface SeedUser {
  id: string;
  name: string;
  email: string;
  plan: "free" | "hobby" | "pro";
  createdAt: number;
}

interface SeedOrg {
  id: string;
  name: string;
  plan: SeedUser["plan"];
  ownerId: string;
  createdAt: number;
  domain: { id: string; hostname: string } | null;
}

async function seed() {
  const now = Date.now();
  const day = 86_400_000;
  const passwordHash = await hashPassword(PASSWORD);

  const users: SeedUser[] = [];
  const emailSeen = new Set<string>();
  const makeUser = (plan: SeedUser["plan"]): SeedUser => {
    let name = "",
      email = "";
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

  const owners = Array.from({ length: CONFIG.orgs }, () =>
    makeUser(
      pickW([
        ["pro", 20],
        ["hobby", 30],
        ["free", 50],
      ]),
    ),
  );
  const pool = Array.from({ length: CONFIG.extraUsersPool }, () => makeUser("free"));

  let paidSeen = 0;
  const billingFor = (u: SeedUser) => {
    if (u.plan === "free") return { sub: false, comp: null, leaving: false };
    const seen = paidSeen++;
    if (seen % 5 === 4) return { sub: false, comp: u.plan, leaving: false };
    return { sub: true, comp: null, leaving: seen % 3 === 0 };
  };

  const userRows = users.map((u, index) => {
    const { sub, comp, leaving } = billingFor(u);
    // A subscriber has Polar ids, a comped user none: /billing shows the difference.
    return `(${q(u.id)}, ${q(u.name)}, ${q(u.email)}, 1, ${q(u.plan)}, ${
      sub ? q(u.plan) : "NULL"
    }, ${sub ? "'active'" : "NULL"}, ${sub ? q(`sub_seed_${u.id.slice(5)}`) : "NULL"}, ${
      sub ? q(`cus_seed_${u.id.slice(5)}`) : "NULL"
    }, ${leaving ? 1 : 0}, ${
      sub ? now + randInt(3, 28) * day : "NULL"
    }, ${comp ? q(comp) : "NULL"}, ${comp ? "'Seeded comp'" : "NULL"}, ${
      comp ? u.createdAt : "NULL"
    }, ${index % 4 === 0 ? `${u.createdAt}, 'settings'` : "NULL, NULL"}, ${
      index % 5 === 0 ? `${u.createdAt}, 'onboarding'` : "NULL, NULL"
    }, ${u.createdAt}, ${u.createdAt}, ${u.createdAt})`;
  });
  const accountRows = users.map(
    (u) =>
      `(${q(`seed-acc-${u.id.slice(5)}`)}, ${q(u.id)}, 'credential', ${q(u.id)}, ${q(passwordHash)}, ${u.createdAt}, ${u.createdAt})`,
  );
  await sqlBatch([
    `INSERT INTO user (id, name, email, email_verified, plan, subscription_plan,
       subscription_status, polar_subscription_id, polar_customer_id,
       polar_subscription_cancel_at_period_end, polar_subscription_current_period_end,
       comp_plan, comp_reason, comp_granted_at, news_opt_in_at, news_opt_in_source,
       offers_opt_in_at, offers_opt_in_source, marketing_asked_at, created_at, updated_at)
     VALUES ${userRows.join(",")}`,
    `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ${accountRows.join(",")}`,
  ]);

  const memberCap = { free: 3, hobby: 5, pro: 25 } as const;
  const linkRange = { free: [6, 28], hobby: [30, 110], pro: [60, 220] } as const;

  const orgs: SeedOrg[] = [];
  const orgStatements: string[] = [];
  const orgCountries = new Map<string, (readonly [string, number])[]>();

  for (let i = 0; i < CONFIG.orgs; i++) {
    const owner = owners[i];
    const org: SeedOrg = {
      id: uid(),
      name: makeOrgName(),
      plan: owner.plan,
      ownerId: owner.id,
      createdAt: owner.createdAt + randInt(0, 3) * day,
      domain: null,
    };
    orgs.push(org);
    orgCountries.set(org.id, randomCountryMix());
    orgStatements.push(
      `INSERT INTO orgs (id, name, created_at) VALUES (${q(org.id)}, ${q(org.name)}, ${org.createdAt})`,
    );

    const memberRows = [`(${q(org.id)}, ${q(owner.id)}, 'owner', ${org.createdAt})`];
    const others = [...pool].sort(() => rand() - 0.5).slice(0, randInt(1, memberCap[org.plan] - 1));
    for (const m of others) {
      const role = rand() < 0.3 ? "admin" : "member";
      memberRows.push(
        `(${q(org.id)}, ${q(m.id)}, ${q(role)}, ${org.createdAt + randInt(1, 40) * day})`,
      );
    }
    orgStatements.push(
      `INSERT INTO org_members (org_id, user_id, role, created_at) VALUES ${memberRows.join(",")}`,
    );

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

  interface SeedLink {
    id: string;
    org: SeedOrg;
    slug: string;
    domainId: string | null;
    host: string | null;
    url: string;
    createdAt: number;
    weight: number; // relative popularity
  }
  interface SeedAddress {
    id: string;
    linkId: string;
    org: SeedOrg;
    slug: string;
    domainId: string | null;
    host: string | null;
    kind: "primary" | "temp_alias" | "permanent_alias";
    creationReason: "created" | "renamed" | "promoted" | "same_destination_merge" | "";
    expiresAt: number | null;
    retiredAt: number | null;
    createdAt: number;
  }
  const links: SeedLink[] = [];
  const addresses: SeedAddress[] = [];
  const usedSlugs = new Set<string>();

  const nextSlug = (custom: boolean) => {
    let slug = custom
      ? `${pick(["promo", "menu", "app", "event", "docs", "join", "sale"])}-${randomFrom(SLUG_ALPHABET, 3)}`
      : randomSlug();
    while (usedSlugs.has(slug)) slug = randomSlug();
    usedSlugs.add(slug);
    return slug;
  };

  for (const org of orgs) {
    const [lo, hi] = linkRange[org.plan];
    const count = randInt(lo, hi);
    const memberIds = (
      await sql<{ user_id: string }>(`SELECT user_id FROM org_members WHERE org_id = ${q(org.id)}`)
    ).map((r) => r.user_id);

    const rows: string[] = [];
    const addressRows: string[] = [];
    for (let i = 0; i < count; i++) {
      const onCustomDomain = org.domain !== null && rand() < 0.25;
      const slug = nextSlug(onCustomDomain && rand() < 0.6);
      const domainId = onCustomDomain ? org.domain!.id : null;
      const host = onCustomDomain ? org.domain!.hostname : null;

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
        domainId,
        host,
        url: dest,
        createdAt,
        // Kept modest: total link count scales with `orgs`, and unbounded weight here made local seeding crawl.
        weight: rand() < 0.15 ? randInt(20, 55) : rand() < 0.75 ? randInt(1, 10) : 0,
      };
      links.push(link);
      rows.push(
        `(${q(link.id)}, ${q(org.id)}, ${domainId ? q(domainId) : "NULL"}, ${q(slug)}, ${q(dest)}, ${q(title)}, ${q(utmSource)}, ${q(utmMedium)}, ${q(utmCampaign)}, ${q(pick(memberIds))}, ${createdAt})`,
      );

      const primary: SeedAddress = {
        id: uid(),
        linkId: link.id,
        org,
        slug,
        domainId,
        host,
        kind: "primary",
        creationReason: "",
        expiresAt: null,
        retiredAt: null,
        createdAt,
      };
      addresses.push(primary);

      const aliasChance = onCustomDomain ? 0.35 : 0.08;
      if (rand() < aliasChance) {
        const aliasCount = rand() < 0.25 ? 2 : 1;
        for (let a = 0; a < aliasCount; a++) {
          const aliasSlug = nextSlug(onCustomDomain);
          const aliasCreatedAt = Math.min(
            now,
            createdAt + randInt(1, Math.max(1, Math.floor((now - createdAt) / day))) * day,
          );
          const isTemp = onCustomDomain && rand() < 0.6;
          const alias: SeedAddress = isTemp
            ? {
                id: uid(),
                linkId: link.id,
                org,
                slug: aliasSlug,
                domainId,
                host,
                kind: "temp_alias",
                creationReason: "renamed",
                expiresAt: aliasCreatedAt + ALIAS_TTL_MS,
                retiredAt:
                  aliasCreatedAt + ALIAS_TTL_MS < now ? aliasCreatedAt + ALIAS_TTL_MS : null,
                createdAt: aliasCreatedAt,
              }
            : {
                id: uid(),
                linkId: link.id,
                org,
                slug: aliasSlug,
                domainId,
                host,
                kind: "permanent_alias",
                creationReason: rand() < 0.3 ? "same_destination_merge" : "created",
                expiresAt: null,
                retiredAt:
                  rand() < 0.1 ? Math.min(now, aliasCreatedAt + randInt(1, 30) * day) : null,
                createdAt: aliasCreatedAt,
              };
          addresses.push(alias);
          addressRows.push(
            `(${q(alias.id)}, ${q(alias.linkId)}, ${q(org.id)}, ${alias.domainId ? q(alias.domainId) : "NULL"}, ${q(alias.slug)}, ${q(alias.kind)}, ${q(alias.creationReason)}, ${alias.expiresAt ?? "NULL"}, ${alias.retiredAt ?? "NULL"}, ${alias.createdAt})`,
          );
        }
      }
      addressRows.push(
        `(${q(primary.id)}, ${q(primary.linkId)}, ${q(org.id)}, ${primary.domainId ? q(primary.domainId) : "NULL"}, ${q(primary.slug)}, 'primary', '', NULL, NULL, ${primary.createdAt})`,
      );
    }
    for (let i = 0; i < rows.length; i += 50) {
      await sqlBatch([
        `INSERT INTO links (id, org_id, domain_id, slug, destination, title, utm_source, utm_medium, utm_campaign, created_by, created_at) VALUES ${rows.slice(i, i + 50).join(",")}`,
      ]);
    }
    for (let i = 0; i < addressRows.length; i += 50) {
      await sqlBatch([
        `INSERT INTO link_addresses (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at) VALUES ${addressRows.slice(i, i + 50).join(",")}`,
      ]);
    }
  }

  const linkById = new Map(links.map((l) => [l.id, l]));
  const liveAddresses = addresses.filter((a) => a.retiredAt === null); // retired addresses resolve to nothing
  // One KV PUT per address is thousands of round trips: run a few at once.
  const KV_CONCURRENCY = 8;
  let publishedAddresses = 0;
  for (let i = 0; i < liveAddresses.length; i += KV_CONCURRENCY) {
    const slice = liveAddresses.slice(i, i + KV_CONCURRENCY);
    await Promise.all(
      slice.map((address) => {
        const link = linkById.get(address.linkId)!;
        return kvPut(
          address.host ? `slug:${address.host}:${address.slug}` : `slug:${address.slug}`,
          {
            linkId: link.id,
            addressId: address.id,
            orgId: address.org.id,
            url: link.url,
            expiresAt: address.expiresAt,
          },
        );
      }),
    );
    publishedAddresses += slice.length;
  }
  console.log(
    `  links published to KV: ${publishedAddresses} (${links.length} links, ${addresses.length - links.length} aliases)`,
  );

  let totalClicks = 0;
  const clickValues: string[] = [];
  const baseHourWeights = [
    1, 0.5, 0.3, 0.2, 0.2, 0.5, 1, 1.5, 3, 5, 6, 6, 4, 3, 5, 6, 5, 4, 3, 2, 1.5, 1, 0.8, 0.5,
  ] as const;

  for (const link of links) {
    if (link.weight === 0) continue;
    const ageDays = Math.min(
      CONFIG.clickDays,
      Math.max(1, Math.floor((now - link.createdAt) / day)),
    );

    const dailyMult: number[] = [];
    for (let d = 0; d < ageDays; d++) {
      let m = 0;
      if (rand() < 0.32) {
        m = rand() < 0.2 ? randInt(8, 25) : randInt(1, 5);
      }
      dailyMult.push(m);
    }
    const maxIdx = dailyMult.indexOf(Math.max(...dailyMult));
    if (dailyMult[maxIdx] === 0) {
      dailyMult[randInt(0, ageDays - 1)] = randInt(8, 25);
    }

    const spikeHours = new Set<number>();
    if (rand() < 0.7) spikeHours.add(randInt(8, 18));
    if (rand() < 0.35) spikeHours.add(randInt(0, 23));

    for (let d = 0; d < ageDays; d++) {
      if (dailyMult[d] === 0) continue;
      const recency = Math.pow((ageDays - d) / ageDays, 1.5) * 0.6 + 0.4;
      const n = Math.min(
        35,
        Math.max(0, Math.round(link.weight * dailyMult[d] * recency * (0.5 + rand()))),
      );
      if (n <= 0) continue;

      for (let i = 0; i < n; i++) {
        const base = new Date(now - d * day);
        const dayStart = base.getTime() - (base.getTime() % day);
        const hourWeights = baseHourWeights.map(
          (w, h) => [h, w * (spikeHours.has(h) ? randInt(5, 25) : 1)] as const,
        );
        const h = pickW(hourWeights);
        const offset = h * 3_600_000 + randInt(0, 3_599_999);
        // Today has only run until now: fit a whole day's clicks into the hours so far, so no chart ends in a dip.
        const t =
          d === 0 ? dayStart + Math.floor((offset / day) * (now - dayStart)) : dayStart + offset;
        clickValues.push(
          `(${q(link.id)}, ${q(link.org.id)}, ${t}, ${q(pickW(orgCountries.get(link.org.id)!))}, ${q(pickW(REFERRERS))}, ${q(pickW(DEVICES))})`,
        );
        totalClicks++;
      }
    }
  }
  // Bigger batches, a few in flight: single-row batches slow down as the clicks table and its indexes grow.
  const CLICK_BATCH = 500; // D1 caps statement text size; larger batches hit SQLITE_TOOBIG
  const CLICK_CONCURRENCY = 8;
  const clickBatches: string[] = [];
  for (let i = 0; i < clickValues.length; i += CLICK_BATCH) {
    clickBatches.push(
      `INSERT INTO clicks (link_id, org_id, ts, country, referrer, device) VALUES ${clickValues.slice(i, i + CLICK_BATCH).join(",")}`,
    );
  }
  let clicksInserted = 0;
  for (let i = 0; i < clickBatches.length; i += CLICK_CONCURRENCY) {
    const slice = clickBatches.slice(i, i + CLICK_CONCURRENCY);
    await Promise.all(slice.map((stmt) => sqlBatch([stmt])));
    clicksInserted = Math.min(clickValues.length, (i + slice.length) * CLICK_BATCH);
    console.log(`  clicks inserted: ${clicksInserted}/${clickValues.length}`);
  }

  await buildRollups();

  await seedDowngrades(orgs, now, day);

  await seedClickUsage();
  await seedLinkQrLooks();
  await seedLastSeen(now, day);

  await seedScenarioAccounts(passwordHash, now, day);
  await seedPlanHistory(now, day);
  await seedEdgeCases(now);

  // Written past allocateSharedSlug, so record its shared-domain slugs as the app would.
  await sqlBatch([
    "INSERT OR IGNORE INTO issued_slugs (slug, issued_at) SELECT slug, created_at FROM link_addresses WHERE domain_id IS NULL",
  ]);

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

/** Written into the org the `pro-owner` scenario opens (same query as dev-scenarios.ts). Runs after buildRollups:
 * seven-figure counts go straight into the rollups. */
async function seedEdgeCases(now: number): Promise<void> {
  const [org] = await sql<{ id: string; owner: string }>(
    `SELECT o.id, u.id AS owner FROM orgs o
     JOIN org_members m ON m.org_id = o.id AND m.role = 'owner'
     JOIN user u ON u.id = m.user_id
     WHERE u.email LIKE '%@seed.test' AND u.plan = 'pro'
       AND o.id NOT IN (SELECT org_id FROM org_entitlements) AND o.locked_at IS NULL
     ORDER BY (SELECT count(*) FROM links l WHERE l.org_id = o.id) DESC LIMIT 1`,
  );
  if (!org) return;
  const hour = 3_600_000;
  const day = 24 * hour;

  const longHost =
    "go.the-very-long-and-entirely-unnecessary-name-of-our-agency.campaigns-and-partnerships-europe.test";
  const idnHost = new URL("https://kürzer.bäckerei-müller-straße.test").hostname;
  const domains = [
    { id: uid(), hostname: longHost },
    { id: uid(), hostname: idnHost },
  ];
  await sqlBatch(
    domains.map(
      (d) =>
        `INSERT INTO domains (id, org_id, hostname, status, created_at) VALUES (${q(d.id)}, ${q(org.id)}, ${q(d.hostname)}, 'active', ${now - 40 * day})`,
    ),
  );
  for (const d of domains)
    await kvPut(`domain:${d.hostname}`, { domainId: d.id, orgId: org.id, rootRedirect: "" });
  const [long, idn] = domains;

  type Alias = { slug: string; temp?: boolean; clicks?: number };
  type Edge = {
    title: string;
    destination: string;
    slug?: string;
    domain?: { id: string; hostname: string };
    clicks?: number;
    rawClicks?: number;
    aliases?: Alias[];
  };
  const shared = () => randomSlug();
  const edges: Edge[] = [
    {
      title: "",
      destination: "https://example.com",
    },
    {
      title:
        "Spring 2026 regional launch campaign for the printed flyers we are handing out in every northern store, the trade fair booth and the partner newsletter, second revision after legal review",
      destination:
        "https://shop.example.com/collections/spring-2026/limited-edition/outdoor-furniture-and-garden-accessories/teak-folding-chairs-with-cushions?utm_source=print&utm_medium=flyer&utm_campaign=spring-2026-northern-region-launch&utm_content=back-cover-qr-code-variant-b&ref=partner-newsletter-april&lang=en-GB",
      domain: long,
      slug: "spring-2026-printed-flyer-for-the-northern-region-store-v2-final",
      rawClicks: 214,
      aliases: Array.from({ length: 10 }, (_, i): Alias => ({
        slug: `flyer-${["north", "south", "east", "west", "booth", "partner", "newsletter", "poster", "receipt", "packaging"][i]}-${i + 1}`,
        clicks: [1_204, 312, 48, 7, 0, 0, 1, 0, 95, 0][i],
      })),
    },
    {
      title: "Renamed: summer menu",
      destination: "https://restaurant.example.com/menu/summer",
      domain: long,
      slug: "summer-menu-2026",
      rawClicks: 38,
      aliases: [
        { slug: "menu-summer", temp: true, clicks: 21 },
        { slug: "menu", clicks: 4 },
        { slug: "carte-ete", clicks: 0 },
      ],
    },
    {
      title: "Homepage",
      destination: "https://www.example.com/",
      clicks: 9_874_312,
    },
    {
      title: "Bäckerei Müller: Brötchen vorbestellen",
      destination: "https://bücher-und-brötchen.example/straße/bestellung",
      domain: idn,
      slug: "broetchen-bestellen",
      clicks: 1_204_887,
      aliases: [{ slug: "fruehstueck", clicks: 3 }],
    },
    {
      title: "🎉 Summer sale ☀️ 50% off: café crème, piñatas & 日本語のテキスト 🇮🇹🚀",
      destination: "https://example.com/sale?emoji=%F0%9F%8E%89",
      rawClicks: 57,
    },
    {
      title: "تخفيضات الصيف: خصم ٥٠٪ على جميع المنتجات حتى نهاية الشهر",
      destination: "https://example.com/ar/summer-sale",
      rawClicks: 12,
    },
    {
      title: "עברית ו-English באותה שורה: מבצע 2026",
      destination: "https://example.com/he/sale",
    },
    {
      title:
        "Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaftsausweisnummer",
      destination: "https://example.com/de/verein",
      rawClicks: 3,
    },
    {
      title: "",
      destination:
        "https://very-long-subdomain-for-tracking.marketing.example-corporation-international.com/landing/2026/q3/a-really-long-path-segment-that-keeps-going/and-another-one?a=1&b=2&c=3&session=8f14e45fceea167a5a36dedd4bea2543",
      domain: long,
      slug: "x",
    },
    {
      title: "Never clicked",
      destination: "https://example.com/quiet",
    },
  ];

  const linkRows: string[] = [];
  const addressRows: string[] = [];
  const clickRows: string[] = [];
  const rollupRows: string[] = [];
  const kv: [string, JsonValue][] = [];
  const rawLinkIds: string[] = [];
  const countries = ["US", "DE", "GB", "IT", "JP", "BR", "IN", ""];
  const referrers = ["", "google.com", "t.co", "linkedin.com"];
  const devices = ["mobile", "desktop", "tablet"];

  for (const [i, edge] of edges.entries()) {
    const linkId = uid();
    const createdAt = now - (i + 1) * 80 * 60_000;
    const slug = edge.slug ?? shared();
    const domainId = edge.domain?.id ?? null;
    const host = edge.domain?.hostname ?? null;
    linkRows.push(
      `(${q(linkId)}, ${q(org.id)}, ${domainId ? q(domainId) : "NULL"}, ${q(slug)}, ${q(edge.destination)}, ${q(edge.title)}, ${q(org.owner)}, ${createdAt})`,
    );
    const addresses: { id: string; slug: string; alias?: Alias }[] = [
      { id: uid(), slug },
      ...(edge.aliases ?? []).map((alias) => ({ id: uid(), slug: alias.slug, alias })),
    ];
    for (const a of addresses) {
      const kind = !a.alias ? "primary" : a.alias.temp ? "temp_alias" : "permanent_alias";
      const expiresAt = a.alias?.temp ? now + 30 * hour : null;
      addressRows.push(
        `(${q(a.id)}, ${q(linkId)}, ${q(org.id)}, ${domainId ? q(domainId) : "NULL"}, ${q(a.slug)}, ${q(kind)}, ${q(
          !a.alias ? "" : a.alias.temp ? "renamed" : "created",
        )}, ${expiresAt ?? "NULL"}, NULL, ${createdAt + 60_000})`,
      );
      kv.push([
        host ? `slug:${host}:${a.slug}` : `slug:${a.slug}`,
        { linkId, addressId: a.id, orgId: org.id, url: edge.destination, expiresAt },
      ]);
      const n = a.alias ? (a.alias.clicks ?? 0) : (edge.rawClicks ?? 0);
      for (let c = 0; c < n; c++) {
        const ts = now - randInt(0, 6 * day);
        clickRows.push(
          `(${q(linkId)}, ${q(org.id)}, ${ts}, ${q(pick(countries))}, ${q(pick(referrers))}, ${q(pick(devices))}, ${a.alias ? q(a.id) : "NULL"})`,
        );
      }
      if (n) rawLinkIds.push(linkId);
    }

    // Added to the rollups, not inserted: an alias's raw clicks may already have rolled up into the same days.
    if (edge.clicks) {
      const days = 90;
      const weights = Array.from({ length: days }, (_, d) => (days - d) ** 1.5 * (0.6 + rand()));
      const sum = weights.reduce((s, w) => s + w, 0);
      const perDay = weights.map((w) => Math.floor((w / sum) * edge.clicks!));
      perDay[0] += edge.clicks - perDay.reduce((s, n) => s + n, 0);
      for (const [d, n] of perDay.entries()) {
        const date = new Date(now - d * day).toISOString().slice(0, 10);
        const split = (values: string[]) => {
          let left = n;
          return values.map((v, k) => {
            const share = k === values.length - 1 ? left : Math.floor(left * (0.4 + rand() * 0.3));
            left -= share;
            return [v, share] as const;
          });
        };
        rollupRows.push(
          `INSERT INTO click_daily (org_id, day, link_id, clicks) VALUES (${q(org.id)}, ${q(date)}, ${q(linkId)}, ${n}) ON CONFLICT DO UPDATE SET clicks = clicks + excluded.clicks`,
        );
        const dims = [
          ...split(["US", "DE", "GB", "JP", "BR"]).map(([v, c]) => ["country", v, c] as const),
          ...split(["google.com", "", "t.co", "linkedin.com"]).map(
            ([v, c]) => ["referrer", v, c] as const,
          ),
          ...split(devices).map(([v, c]) => ["device", v, c] as const),
        ].filter(([, , c]) => c > 0);
        rollupRows.push(
          `INSERT INTO click_daily_dims (org_id, dim, day, value, link_id, clicks) VALUES ${dims
            .map(
              ([dim, v, c]) => `(${q(org.id)}, ${q(dim)}, ${q(date)}, ${q(v)}, ${q(linkId)}, ${c})`,
            )
            .join(",")} ON CONFLICT DO UPDATE SET clicks = clicks + excluded.clicks`,
        );
        if (d === 0) {
          const start = now - (now % day);
          const hours = Math.max(1, Math.floor((now - start) / hour) + 1);
          for (let h = 0; h < hours; h++) {
            const share =
              h === hours - 1 ? n - Math.floor(n / hours) * (hours - 1) : Math.floor(n / hours);
            rollupRows.push(
              `INSERT INTO click_hourly (org_id, hour, link_id, clicks) VALUES (${q(org.id)}, ${start + h * hour}, ${q(linkId)}, ${share}) ON CONFLICT DO UPDATE SET clicks = clicks + excluded.clicks`,
            );
          }
        }
      }
    }
  }

  await sqlBatch([
    `INSERT INTO links (id, org_id, domain_id, slug, destination, title, created_by, created_at) VALUES ${linkRows.join(",")}`,
    `INSERT INTO link_addresses (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at) VALUES ${addressRows.join(",")}`,
  ]);
  for (let i = 0; i < clickRows.length; i += 500)
    await sqlBatch([
      `INSERT INTO clicks (link_id, org_id, ts, country, referrer, device, address_id) VALUES ${clickRows.slice(i, i + 500).join(",")}`,
    ]);
  const ids = [...new Set(rawLinkIds)].map(q).join(",");
  if (ids) await sqlBatch(await rollupBackfill(`link_id IN (${ids})`));
  for (let i = 0; i < rollupRows.length; i += 50) await sqlBatch(rollupRows.slice(i, i + 50));
  for (const [key, value] of kv) await kvPut(key, value);
  console.log(
    `  edge cases: ${edges.length} links (${kv.length - edges.length} aliases) in ${org.id}, domains ${domains.map((d) => d.hostname).join(", ")}`,
  );
}

async function seedScenarioAccounts(passwordHash: string, now: number, day: number) {
  const accounts = [
    {
      key: "fresh",
      name: "Sam Rivera",
      email: "fresh.account@seed.test",
      admin: 0,
      asked: 1,
      org: defaultOrgName("sam.rivera@gmail.com", "Sam Rivera"),
    },
    {
      key: "unasked",
      name: "Nico Pending",
      email: "unasked.account@seed.test",
      admin: 0,
      asked: 0,
      org: defaultOrgName("nico.pending@gmail.com", "Nico Pending"),
    },
    {
      key: "admin",
      name: "Ada Platform",
      email: "platform.admin@seed.test",
      admin: 1,
      asked: 1,
      org: defaultOrgName("ada.platform@gmail.com", "Ada Platform"),
    },
  ];
  const statements: string[] = [];
  for (const a of accounts) {
    const userId = `seed-scn-${a.key}`;
    const orgId = `seed-scn-org-${a.key}`;
    const at = a.key === "fresh" ? now - 60_000 : now - 200 * day;
    statements.push(
      `INSERT INTO user (id, name, email, email_verified, plan, is_admin, marketing_asked_at, created_at, updated_at)
       VALUES (${q(userId)}, ${q(a.name)}, ${q(a.email)}, 1, 'free', ${a.admin}, ${a.asked ? at : "NULL"}, ${at}, ${at})`,
      `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES (${q(`seed-acc-scn-${a.key}`)}, ${q(userId)}, 'credential', ${q(userId)}, ${q(passwordHash)}, ${at}, ${at})`,
      `INSERT INTO orgs (id, name, created_at) VALUES (${q(orgId)}, ${q(a.org)}, ${at})`,
      `INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (${q(orgId)}, ${q(userId)}, 'owner', ${at})`,
    );
  }
  await sqlBatch(statements);
  console.log(`  scenario accounts: ${accounts.map((a) => a.email).join(", ")}`);
}

/** Marks are written directly, as `reconcileUser` writes them: keep in step with src/worker/reconcile.ts. */
async function seedDowngrades(orgs: SeedOrg[], now: number, day: number): Promise<void> {
  const withDomains = orgs.filter((o) => o.plan !== "free" && o.domain !== null);
  if (!withDomains.length) return;
  const memberCounts = new Map(
    (
      await sql<{ org_id: string; n: string }>(
        "SELECT org_id, count(*) AS n FROM org_members WHERE org_id LIKE 'seed-%' GROUP BY org_id",
      )
    ).map((r) => [r.org_id, Number(r.n)]),
  );
  const candidates = withDomains
    .sort((a, b) => (memberCounts.get(b.id) ?? 0) - (memberCounts.get(a.id) ?? 0))
    .slice(0, 3);

  const statements: string[] = [];
  const free = PLAN_LIMITS.free;

  for (const [index, org] of candidates.entries()) {
    const graceEndsAt = now + [27 * day, 6 * day, -2 * day][index];

    const [links, members] = await Promise.all([
      sql<{ n: string }>(
        `SELECT count(*) AS n FROM link_addresses WHERE org_id = ${q(org.id)} AND retired_at IS NULL AND kind IN ('primary','permanent_alias')`,
      ),
      sql<{ user_id: string; role: string }>(
        `SELECT user_id, role FROM org_members WHERE org_id = ${q(org.id)} ORDER BY created_at, user_id`,
      ),
    ]);
    const linkCount = Number(links[0]?.n ?? 0);

    const over: OverLimits = { domains: 1 };
    if (linkCount > free.links) over.links = linkCount;
    if (members.length > free.members) over.members = members.length;

    statements.push(`UPDATE user SET plan = 'free' WHERE id = ${q(org.ownerId)}`);
    statements.push(
      `UPDATE domains SET locked_at = ${now} WHERE org_id = ${q(org.id)}`,
      // Not 'rounded'/'extra-rounded': the built-in defaults are the empty string here, and the pickers omit them (#162).
      `UPDATE orgs SET qr_style = 'dots', qr_corner = 'dot', qr_color = '#7c5cff', qr_eye_color = '#2f1f5e' WHERE id = ${q(org.id)}`,
      `INSERT INTO org_entitlements (org_id, plan, over_json, grace_ends_at, reconciled_at, notified_at)
       VALUES (${q(org.id)}, 'free', ${q(JSON.stringify(over))}, ${graceEndsAt}, ${now}, ${now})`,
    );

    const keep = new Set(members.slice(0, free.members).map((m) => m.user_id));
    for (const member of members) {
      if (keep.has(member.user_id) || member.role === "owner" || member.role === "viewer") continue;
      statements.push(
        `UPDATE org_members SET role = 'viewer', previous_role = ${q(member.role)}
         WHERE org_id = ${q(org.id)} AND user_id = ${q(member.user_id)}`,
      );
    }

    // The redirect path reads the deadline off KV, never D1: a lock that skipped this would serve forever.
    await kvPut(`domain:${org.domain!.hostname}`, {
      domainId: org.domain!.id,
      orgId: org.id,
      rootRedirect: "",
      servesUntil: graceEndsAt,
    });
  }

  const extraOrgId = uid();
  statements.push(
    `INSERT INTO orgs (id, name, created_at, locked_at) VALUES (${q(extraOrgId)}, ${q(`${candidates[0].name} Labs`)}, ${now - 30 * day}, ${now})`,
    `INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (${q(extraOrgId)}, ${q(candidates[0].ownerId)}, 'owner', ${now - 30 * day})`,
  );

  await sqlBatch(statements);
  const moved = await moveLinksToOrg(candidates[0].id, extraOrgId, 24);
  console.log(`  downgraded: ${candidates.length} orgs, 1 locked org with ${moved} links`);
}

/** The locked org exists only after the links are seeded, and a read-only org with nothing in it shows the empty state. */
async function moveLinksToOrg(from: string, to: string, limit: number): Promise<number> {
  const rows = await sql<{ id: string }>(
    `SELECT id FROM links WHERE org_id = ${q(from)} AND domain_id IS NULL ORDER BY created_at DESC LIMIT ${limit}`,
  );
  if (!rows.length) return 0;
  const ids = rows.map((r) => q(r.id)).join(",");
  await sqlBatch(
    ["links", "link_addresses", "clicks", "click_daily", "click_hourly", "click_daily_dims"].map(
      (table) =>
        `UPDATE ${table} SET org_id = ${q(to)} WHERE ${table === "links" ? "id" : "link_id"} IN (${ids})`,
    ),
  );
  const addresses = await sql<{
    id: string;
    link_id: string;
    slug: string;
    expires_at: string | null;
    destination: string;
  }>(
    `SELECT a.id, a.link_id, a.slug, a.expires_at, l.destination FROM link_addresses a JOIN links l ON l.id = a.link_id
      WHERE a.link_id IN (${ids}) AND a.retired_at IS NULL`,
  );
  await Promise.all(
    addresses.map((a) =>
      kvPut(`slug:${a.slug}`, {
        linkId: a.link_id,
        addressId: a.id,
        orgId: to,
        url: a.destination,
        expiresAt: a.expires_at === null ? null : Number(a.expires_at),
      }),
    ),
  );
  return rows.length;
}

async function seedLinkQrLooks(): Promise<void> {
  const looks = [
    "qr_style = 'dots', qr_corner = 'dot', qr_color = '#1f6f5c'",
    "qr_style = 'classy', qr_corner = 'square', qr_color = '#7c3a1d', qr_bg = '#fff7ec'",
    "qr_color = '#2f1f5e', qr_eye_color = '#7c5cff'",
  ];
  const rows = await sql<{ id: string }>(
    `SELECT l.id FROM links l JOIN orgs o ON o.id = l.org_id
      WHERE l.org_id LIKE 'seed-%' AND o.locked_at IS NULL
      ORDER BY (SELECT count(*) FROM clicks c WHERE c.link_id = l.id) DESC LIMIT 60`,
  );
  const statements = rows
    .filter((_, i) => i % 4 === 0)
    .map((r, i) => `UPDATE links SET ${looks[i % looks.length]} WHERE id = ${q(r.id)}`);
  await sqlBatch(statements);
  console.log(`  QR looks: ${statements.length} links`);
}

async function seedPlanHistory(now: number, day: number): Promise<void> {
  const entry = (from: string, to: string, ago: string) =>
    `INSERT INTO admin_actions (id, actor_user_id, action, target_type, target_id, detail, created_at)
     SELECT 'seed-plan-' || id, 'polar', 'plan.change', 'user', id,
            json_object('from', ${q(from)}, 'to', ${q(to)}, 'email', email),
            ${now} - ${ago}
     FROM user`;
  await sqlBatch([
    `UPDATE user SET audited_plan = plan`,
    `${entry("free", "pro", `(abs(random()) % ${20 * day})`)}
     WHERE id LIKE 'seed-%' AND plan = 'pro' AND comp_plan IS NULL LIMIT 3`,
    `${entry("free", "hobby", `(abs(random()) % ${20 * day})`)}
     WHERE id LIKE 'seed-%' AND plan = 'hobby' AND comp_plan IS NULL LIMIT 3`,
    `${entry("pro", "free", `(abs(random()) % ${10 * day})`)}
     WHERE id LIKE 'seed-%' AND plan = 'free' LIMIT 1`,
  ]);
}

async function seedLastSeen(now: number, day: number): Promise<void> {
  await sqlBatch([
    `UPDATE user SET last_seen_at = CASE WHEN abs(random()) % 8 = 0 THEN NULL
       ELSE ${now} - abs(random()) % ${30 * day} END
     WHERE id LIKE 'seed-%'`,
  ]);
}

async function seedClickUsage(): Promise<void> {
  const migration = await Bun.file(
    new URL("../migrations/0043_org_click_usage.sql", import.meta.url),
  ).text();
  const backfill = migration
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .filter((q) => /INSERT INTO org_click_usage.*SELECT/s.test(q))
    .map((q) => q.replace("WHERE ts >=", "WHERE org_id LIKE 'seed-%' AND ts >="));
  if (backfill.length !== 1) throw new Error("migration 0043 no longer has its backfill");
  await sqlBatch(backfill);

  const ordinary = await sql<{ id: string; name: string; email: string; plan: string }>(
    `SELECT o.id, o.name, u.email, u.plan FROM orgs o
     JOIN org_members m ON m.org_id = o.id AND m.role = 'owner'
     JOIN user u ON u.id = m.user_id
     WHERE o.id LIKE 'seed-%' AND o.locked_at IS NULL
       AND o.id NOT IN (SELECT org_id FROM org_entitlements)
     ORDER BY o.created_at, o.id`,
  );
  const [capped, near] = (["free", "hobby"] as const).map((plan) =>
    ordinary.find((o) => o.plan === plan),
  );
  const month = new Date().toISOString().slice(0, 7);
  const set = (org: { id: string }, clicks: number) =>
    `INSERT INTO org_click_usage (org_id, month, clicks) VALUES (${q(org.id)}, ${q(month)}, ${clicks})
     ON CONFLICT (org_id, month) DO UPDATE SET clicks = excluded.clicks`;
  const statements: string[] = [];
  if (capped) statements.push(set(capped, PLAN_LIMITS.free.trackedClicks));
  if (near) statements.push(set(near, Math.ceil(PLAN_LIMITS.hobby.trackedClicks * 0.85)));
  await sqlBatch(statements);
  for (const [label, org] of [
    ["at its click cap", capped],
    ["past 80% of its click cap", near],
  ] as const) {
    if (org) console.log(`  ${label}: ${org.name} (${org.email})`);
  }
}

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
