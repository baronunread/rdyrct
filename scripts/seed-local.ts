/**
 * Seed the LOCAL dev environment with fake orgs, members, links and clicks.
 *
 * Talks only to the local Explorer API (https://rdyrct.localhost), so it can
 * never touch remote D1/KV. Run the dev server first, then:
 *
 *   bun run db:seed:local           # wipe previous seed data, re-seed
 *   bun run db:seed:local -- --wipe # only remove seed data
 *
 * Every seeded row carries a "seed-" id prefix and every seeded user email
 * ends in @seed.test, so re-runs are idempotent. All seeded users share the
 * password below and have verified emails, so you can log in as any of them.
 */

import { ALIAS_TTL_MS } from "../src/worker/util";

const API = "https://rdyrct.localhost/cdn-cgi/explorer/api";
const PASSWORD = "seed-password-123";

const CONFIG = {
  orgs: 60,
  extraUsersPool: 220, // non-owner users to spread across orgs as members
  clickDays: 90, // how far back click history goes
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
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
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

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
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
  const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `pbkdf2:${iterations}:${b64(salt.buffer)}:${b64(hash)}`;
}

/* ---------------- data pools ---------------- */

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
  // ORG_NAME_PREFIX x ORG_NAME_SUFFIX is a finite pool: once CONFIG.orgs
  // approaches it, fall back to a numbered suffix instead of spinning forever.
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

/** Broad pool spanning every populated continent, so different orgs land on
 * different parts of the world map instead of all skewing US/Western Europe. */
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
/** Each org gets its own randomized subset and weighting of the pool, so
 * click distributions (and the country ranking + map) vary org to org. */
function randomCountryMix(): (readonly [string, number])[] {
  const count = randInt(6, 12);
  const shuffled = [...COUNTRY_POOL].sort(() => rand() - 0.5).slice(0, count);
  // Descending random weights so each mix still has a clear "top country"
  // instead of a flat spread.
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

/* ---------------- wipe previous seed data ---------------- */

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

  // Explicit order instead of trusting cascades.
  //
  // A seed row is not the only thing that can point at a seed domain: sign in
  // as a seeded user, add a link on their domain through the app, and that
  // link carries a real id and a real org. `links.domain_id` and
  // `link_addresses.domain_id` are both NO ACTION, so those rows block the
  // domain delete and the whole wipe fails on a foreign key. Clearing by
  // domain as well as by `seed-` prefix covers them. It cannot take anything
  // else with it: the domain being freed is a seed domain either way.
  await sqlBatch([
    "DELETE FROM clicks WHERE org_id LIKE 'seed-%'",
    "DELETE FROM link_addresses WHERE org_id LIKE 'seed-%'",
    "DELETE FROM link_addresses WHERE domain_id IN (SELECT id FROM domains WHERE id LIKE 'seed-%')",
    "DELETE FROM links WHERE id LIKE 'seed-%'",
    "DELETE FROM links WHERE domain_id IN (SELECT id FROM domains WHERE id LIKE 'seed-%')",
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

  // Same 20% pro / 30% hobby / 50% free split as before, scaled to any org count.
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

  // Paid access comes from one of two places, and the seed has both so the
  // admin views have something to tell apart (#81): most paid owners have a
  // real subscription, and every fifth is comped instead. `plan` is derived
  // from whichever it is.
  // Every third subscriber is on the way out: still paying, still entitled,
  // and gone at the period end. The admin list has its own badge for that
  // state, which needs a row to land on.
  let paidSeen = 0;
  const billingFor = (u: SeedUser) => {
    if (u.plan === "free") return { sub: false, comp: null, leaving: false };
    const seen = paidSeen++;
    if (seen % 5 === 4) return { sub: false, comp: u.plan, leaving: false };
    return { sub: true, comp: null, leaving: seen % 3 === 0 };
  };

  const userRows = users.map((u) => {
    const { sub, comp, leaving } = billingFor(u);
    // A subscriber has Polar ids; a comped user has none. Leaving them off
    // made every seeded subscriber look comped on /billing, which is the one
    // page where the difference is the whole point.
    return `(${q(u.id)}, ${q(u.name)}, ${q(u.email)}, 1, ${q(u.plan)}, ${
      sub ? q(u.plan) : "NULL"
    }, ${sub ? "'active'" : "NULL"}, ${sub ? q(`sub_seed_${u.id.slice(5)}`) : "NULL"}, ${
      sub ? q(`cus_seed_${u.id.slice(5)}`) : "NULL"
    }, ${leaving ? 1 : 0}, ${comp ? q(comp) : "NULL"}, ${comp ? "'Seeded comp'" : "NULL"}, ${
      comp ? u.createdAt : "NULL"
    }, ${u.createdAt}, ${u.createdAt})`;
  });
  const accountRows = users.map(
    (u) =>
      `(${q(`seed-acc-${u.id.slice(5)}`)}, ${q(u.id)}, 'credential', ${q(u.id)}, ${q(passwordHash)}, ${u.createdAt}, ${u.createdAt})`,
  );
  await sqlBatch([
    `INSERT INTO user (id, name, email, email_verified, plan, subscription_plan,
       subscription_status, polar_subscription_id, polar_customer_id,
       polar_subscription_cancel_at_period_end,
       comp_plan, comp_reason, comp_granted_at, created_at, updated_at)
     VALUES ${userRows.join(",")}`,
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

  /* links + addresses (primary + aliases, #38) + KV + clicks */
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
      await sql(`SELECT user_id FROM org_members WHERE org_id = ${q(org.id)}`)
    ).map((r) => r.user_id as string);

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
        // Pareto-ish: a few hot links, a long tail, some dead ones. Kept
        // modest (not the pre-#38 40-100) because `orgs` (and so total link
        // count) now scales much higher: unbounded weight here means clicks
        // grow as orgs x links/org x days, which made local seeding crawl.
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

      // Aliases mirror how real links pick them up: renaming a custom-domain
      // slug leaves a 48h temp_alias, and links occasionally accumulate a
      // permanent_alias from an explicit add or a same-destination merge.
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
                // A small share were later removed by hand and kept for history.
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
  // Same reasoning as the click inserts above: one KV PUT per address is
  // thousands of serial round trips at this scale, so run a few at once.
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

  /* clicks: random per-day spikes + random per-hour spikes */
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

    // Per-day multipliers: most days are quiet, a few spike hard.
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

    // A couple of hot hours for this link, plus a common business-hour bump.
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
        const t = Math.min(now, dayStart + h * 3_600_000 + randInt(0, 3_599_999));
        clickValues.push(
          `(${q(link.id)}, ${q(link.org.id)}, ${t}, ${q(pickW(orgCountries.get(link.org.id)!))}, ${q(pickW(REFERRERS))}, ${q(pickW(DEVICES))})`,
        );
        totalClicks++;
      }
    }
  }
  // Bigger batches + a few requests in flight at once: sequential single-row
  // batches slow down as the clicks table (and its 4 indexes) grows, since
  // each batch is its own HTTP round trip to the local D1 emulator. Running
  // several concurrently keeps wall-clock time roughly flat instead of
  // climbing over the run.
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
