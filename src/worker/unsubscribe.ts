/**
 * The public unsubscribe page, `/unsubscribe?t=<token>` (marketing.ts).
 *
 * Served by the Worker as plain HTML rather than by the SPA, so it works with
 * no sign-in, no cookie and no script, and in a self-hosted copy exactly as
 * on rdyrct.com (a fork that sends newsletters needs it too).
 *
 * The page only ever turns lists off. The token is in an email, and an
 * email can be forwarded: whoever holds it may stop that person's mail, but
 * never start it. GET shows a ticked box for each list the person is on,
 * Save, and a smaller "Unsubscribe from all"; a list they are not on shows
 * as off, with a link to Settings, where signing in is what lets them turn
 * it on. A mail scanner or a link preview fetches every URL in a message,
 * and a GET that changed anything would remove people who never clicked.
 * POST does it:
 *
 * - `action=save` from the form: each list the person is on and left
 *   unticked goes off. A box for a list they are not on is ignored, so a
 *   forged form cannot opt anyone in.
 * - `action=all` from the form (or `scope=all` in the query, from a page
 *   served before the form had boxes): off both lists.
 * - anything else, which is a mail client's RFC 8058 one-click request
 *   (`List-Unsubscribe=One-Click`, token in the query): off the list the
 *   email came from, and only that one, with no page in between.
 *
 * The token names the list the email went to. Besides one-click, that only
 * decides which box comes first.
 */
import { Hono } from "hono";
import * as v from "valibot";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, DB } from "./env";
import { escapeHtml } from "./email-html";
import {
  UNSUBSCRIBE_PATH,
  marketingState,
  setMarketing,
  unsubscribeUser,
  verifyUnsubscribeToken,
} from "./marketing";
import {
  MARKETING_LIST_LABELS,
  MARKETING_LISTS,
  type MarketingList,
  type MarketingState,
} from "@/shared/types";

export const unsubscribeRoutes = new Hono<AppEnv>();

const STYLE = `
:root{color-scheme:light dark;--bg:#f7f4ef;--surface:#fff;--surface-2:#efeae2;--border:#ddd5c8;--text:#2a2733;--muted:#544f61;--accent:#745ab8;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#17151f;--surface:#1f1c2b;--surface-2:#262336;--border:#34304a;--text:#eae7f2;--muted:#c6c2d3;--accent:#cdb9f5;--on-accent:#17151f}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:440px;padding:28px 24px 24px;background:var(--surface);border:1px solid var(--border);border-radius:14px}
p.brand{margin:0 0 20px;font-weight:800;font-size:17px;letter-spacing:-0.02em}
h1{margin:0 0 6px;font-size:20px;line-height:1.3;text-wrap:balance}
p{margin:0 0 16px;color:var(--muted)}
p:last-child{margin-bottom:0}
fieldset{margin:0 0 20px;padding:4px;border:1px solid var(--border);border-radius:12px}
legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
label.list{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 12px;border-radius:8px;cursor:pointer}
label.list+label.list{box-shadow:inset 0 1px 0 var(--border);border-radius:0 0 8px 8px}
label.list:first-of-type{border-radius:8px 8px 0 0}
label.list:only-of-type{border-radius:8px}
div.off{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;padding:8px 16px}
div.off+div.off{box-shadow:inset 0 1px 0 var(--border)}
div.off span{display:flex;flex-direction:column;gap:1px}
div.off b{font-weight:600}
div.off small{color:var(--muted);font-size:13px}
div.off em{flex:none;color:var(--muted);font-size:13px;font-style:normal}
section.offs{margin:24px 0 0;padding:4px 0 0;border-top:1px solid var(--border)}
section.offs h2{margin:12px 0 4px;font-size:15px;line-height:1.4}
section.offs .rows{margin:0 0 8px}
section.offs p{margin:0;font-size:14px}
@media (hover:hover){label.list:hover{background:var(--surface-2)}}
label.list span{display:flex;flex-direction:column;gap:1px}
label.list b{font-weight:600}
label.list small{color:var(--muted);font-size:13px}
input[type=checkbox]{flex:none;width:20px;height:20px;margin:0;accent-color:var(--accent);cursor:pointer}
.actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
button,a.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border:0;border-radius:8px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
button.quiet{padding:0 4px;background:none;color:var(--muted);font-size:14px;font-weight:400;text-decoration:underline;text-underline-offset:3px}
@media (hover:hover){button.quiet:hover{color:var(--text)}}
button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
a{color:var(--text);text-underline-offset:3px}
p.change{display:flex;align-items:center;min-height:44px;margin:4px 0 0}
`;

function page(status: 200 | 400, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body data-page="unsubscribe"><main><p class="brand">rdyrct</p>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The token is in the URL: nothing may keep the page or its address.
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

const invalid = () =>
  page(
    400,
    "Link not valid",
    `<h1>This link is not valid</h1><p>Copy the whole link from the email, or turn these emails off in Settings after you sign in.</p>`,
  );

/** What each list sends, under its name. */
const LIST_HINTS = {
  news: "New features and tips",
  offers: "Deals on paid plans",
} satisfies Record<MarketingList, string>;

const ACCOUNT_MAIL = "Account email, such as sign-in codes, still arrives.";

/** The page's own address, token and all. */
const selfUrl = (token: string) => `${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`;

/** The token's list first: it is the one the reader came about. */
const listsFrom = (first: MarketingList) => [
  first,
  ...MARKETING_LISTS.filter((list) => list !== first),
];

/** A list the reader is on: a ticked box, to untick. */
function listRow(list: MarketingList): string {
  return `<label class="list"><input type="checkbox" name="${list}" value="on" checked><span><b>${MARKETING_LIST_LABELS[list]}</b><small>${LIST_HINTS[list]}</small></span></label>`;
}

/** A list the reader is not on: no box, because this page cannot turn one on. */
function offRow(list: MarketingList): string {
  return `<div class="off"><span><b>${MARKETING_LIST_LABELS[list]}</b><small>${LIST_HINTS[list]}</small></span><em>Off</em></div>`;
}

/** The lists the reader is not on, and where to turn them on. */
function offSection(lists: MarketingList[]): string {
  if (lists.length === 0) return "";
  const how =
    lists.length === 1
      ? `To get it, turn it on in <a href="/settings">Settings</a> after signing in.`
      : `To get these, turn them on in <a href="/settings">Settings</a> after signing in.`;
  return `<section class="offs" aria-labelledby="offs-heading"><h2 id="offs-heading">Not getting</h2><div class="rows">${lists.map(offRow).join("")}</div><p>${how}</p></section>`;
}

/** What the reader gets now, as one sentence. */
function nowGets(state: MarketingState): string {
  if (state.news && state.offers) return "You get product news and offers.";
  if (state.news) return "You get product news only.";
  if (state.offers) return "You get offers only.";
  return `You will not get any rdyrct email. ${ACCOUNT_MAIL}`;
}

unsubscribeRoutes.get("/", async (c) => {
  const token = c.req.query("t") ?? "";
  const named = await verifyUnsubscribeToken(c.env, token);
  if (!named) return invalid();
  const state = await marketingState(drizzle(c.env.DB, { schema }), named.userId);
  const lists = listsFrom(named.list);
  const on = lists.filter((list) => state[list]);
  const off = lists.filter((list) => !state[list]);
  if (on.length === 0) {
    const title = "You get no rdyrct email";
    return page(200, title, `<h1>${title}</h1><p>${ACCOUNT_MAIL}</p>${offSection(off)}`);
  }
  const title = "Stop rdyrct emails";
  return page(
    200,
    title,
    `<h1>${title}</h1><p>Untick a list to stop it. ${ACCOUNT_MAIL}</p><form method="post" action="${escapeHtml(selfUrl(token))}"><fieldset><legend>Lists you get</legend>${on.map(listRow).join("")}</fieldset><div class="actions"><button type="submit" name="action" value="save">Save</button><button type="submit" name="action" value="all" class="quiet">Unsubscribe from all</button></div></form>${offSection(off)}`,
  );
});

/** The form's fields. A one-click body (`List-Unsubscribe=One-Click`) has
 * none of them, which is what tells the two apart. */
const formSchema = v.object({
  action: v.optional(v.picklist(["save", "all"])),
  news: v.optional(v.literal("on")),
  offers: v.optional(v.literal("on")),
});

/** What a POST asks for. `keep` is the boxes left ticked: a list in it
 * stays as it is, on or off. */
type Wanted =
  | { kind: "save"; keep: Record<MarketingList, boolean> }
  | { kind: "off"; from: MarketingList | "all" };

function wantedOf(
  form: v.InferOutput<typeof formSchema>,
  list: MarketingList,
  scope: string | undefined,
): Wanted {
  if (form.action === "save") {
    return { kind: "save", keep: { news: form.news === "on", offers: form.offers === "on" } };
  }
  if (form.action === "all" || scope === "all") return { kind: "off", from: "all" };
  return { kind: "off", from: list };
}

/** Applies the answer; `found` is false for an account that is gone, and
 * `state` is where the reader stands after it. */
async function applyWanted(
  db: DB,
  userId: string,
  wanted: Wanted,
): Promise<{ found: boolean; state: MarketingState }> {
  if (wanted.kind === "off") {
    const found = await unsubscribeUser(db, userId, wanted.from);
    return { found, state: await marketingState(db, userId) };
  }
  // Only a list that is on and was unticked is written: one left on keeps
  // the time and source of its opt-in, and one that is off stays off
  // whatever the form says.
  const before = await marketingState(db, userId);
  const stop = (list: MarketingList) => (before[list] && !wanted.keep[list] ? false : undefined);
  const answer = { source: "settings" as const, news: stop("news"), offers: stop("offers") };
  const { applied, state } = await setMarketing(db, userId, answer);
  return { found: applied, state };
}

// The form and a mail client's one-click request: 200 either way.
unsubscribeRoutes.post("/", async (c) => {
  const log = c.get("log");
  const token = c.req.query("t") ?? "";
  const named = await verifyUnsubscribeToken(c.env, token);
  if (!named) {
    log?.set({ unsubscribe: { valid: false } });
    return invalid();
  }
  const parsed = v.safeParse(formSchema, await c.req.parseBody().catch(() => ({})));
  if (!parsed.success) {
    log?.set({ unsubscribe: { valid: true, form: "invalid" } });
    return page(
      400,
      "Not saved",
      `<h1>That did not save</h1><p><a href="${escapeHtml(selfUrl(token))}">Open the page again</a> and choose your lists.</p>`,
    );
  }
  const wanted = wantedOf(parsed.output, named.list, c.req.query("scope"));
  const db = drizzle(c.env.DB, { schema });
  const { found, state } = await applyWanted(db, named.userId, wanted);
  log?.set({ unsubscribe: { valid: true, list: named.list, wanted, found } });
  log?.audit({
    // The page only turns lists off, from the form or from one click.
    action: "marketing.unsubscribe",
    actor: { type: "user", id: named.userId },
    target: { type: "user", id: named.userId },
    outcome: found ? "success" : "failure",
  });
  const stillGets = state.news || state.offers;
  const heading = wanted.kind === "save" && stillGets ? "Saved" : "You are unsubscribed";
  const next = stillGets
    ? `<p class="change"><a href="${escapeHtml(selfUrl(token))}">Stop more emails</a></p>`
    : `<p>To get them again, turn them on in <a href="/settings">Settings</a> after signing in.</p>`;
  return page(200, heading, `<h1>${heading}</h1><p>${nowGets(state)}</p>${next}`);
});
