/**
 * The public unsubscribe page, `/unsubscribe?t=<token>` (marketing.ts).
 *
 * Served by the Worker as plain HTML rather than by the SPA, so it works with
 * no sign-in, no cookie and no script, and in a self-hosted copy exactly as
 * on rdyrct.com (a fork that sends newsletters needs it too).
 *
 * GET only shows a button. A mail scanner or a link preview fetches every URL
 * in a message, and a GET that unsubscribed would remove people who never
 * clicked. POST does it, from the button or from a mail client's RFC 8058
 * one-click request (`List-Unsubscribe=One-Click`, token in the query).
 *
 * The token names the list the email went to, and the main button (and a
 * mail client's one-click) takes the reader off that list only. A smaller
 * second button, `scope=all` in the query, takes them off both.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv } from "./env";
import { escapeHtml } from "./email-html";
import { UNSUBSCRIBE_PATH, unsubscribeUser, verifyUnsubscribeToken } from "./marketing";
import type { MarketingList } from "@/shared/types";

export const unsubscribeRoutes = new Hono<AppEnv>();

const STYLE = `
:root{color-scheme:light dark;--bg:#f7f4ef;--surface:#fff;--border:#ddd5c8;--text:#2a2733;--muted:#6e6880;--accent:#7a5fc2;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#17151f;--surface:#1f1c2b;--border:#34304a;--text:#eae7f2;--muted:#9d95b3;--accent:#cdb9f5;--on-accent:#17151f}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:420px;padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:14px}
p.brand{margin:0 0 16px;font-weight:800;font-size:18px}
h1{margin:0 0 8px;font-size:20px;line-height:1.35}
p{margin:0 0 16px;color:var(--muted)}
p:last-child{margin-bottom:0}
button,a.button{display:inline-block;height:40px;padding:0 18px;border:0;border-radius:8px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;line-height:40px;text-decoration:none;cursor:pointer}
form+form{margin-top:8px}
button.quiet{height:28px;padding:0;background:none;color:var(--muted);font-size:13px;font-weight:400;line-height:28px;text-decoration:underline;text-underline-offset:2px}
button.quiet:hover{color:var(--text)}
button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
a{color:var(--text)}
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

/** What each list is called in a sentence, and what stops. */
const LIST_COPY = {
  news: {
    name: "product news",
    stops: "You will stop getting product news and tips from rdyrct.",
    again: "Turn it back on in Settings.",
  },
  offers: {
    name: "offers",
    stops: "You will stop getting deals on paid plans from rdyrct.",
    again: "Turn them back on in Settings.",
  },
} satisfies Record<MarketingList, { name: string; stops: string; again: string }>;

const ACCOUNT_MAIL = "Account email, such as sign-in codes, still arrives.";

unsubscribeRoutes.get("/", async (c) => {
  const token = c.req.query("t");
  const named = await verifyUnsubscribeToken(c.env, token);
  if (!named) return invalid();
  const copy = LIST_COPY[named.list];
  const action = `${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token ?? "")}`;
  return page(
    200,
    `Unsubscribe from ${copy.name}`,
    `<h1>Unsubscribe from ${copy.name}?</h1><p>${copy.stops} ${ACCOUNT_MAIL}</p><form method="post" action="${escapeHtml(action)}"><button type="submit">Unsubscribe</button></form><form method="post" action="${escapeHtml(`${action}&scope=all`)}"><button type="submit" class="quiet">Unsubscribe from all rdyrct email</button></form>`,
  );
});

// Both the page's buttons and a mail client's one-click request: 200 either
// way. One-click carries no scope, so it only ever takes the token's list.
unsubscribeRoutes.post("/", async (c) => {
  const log = c.get("log");
  const named = await verifyUnsubscribeToken(c.env, c.req.query("t"));
  if (!named) {
    log?.set({ unsubscribe: { valid: false } });
    return invalid();
  }
  const from = c.req.query("scope") === "all" ? "all" : named.list;
  const found = await unsubscribeUser(drizzle(c.env.DB, { schema }), named.userId, from);
  log?.set({ unsubscribe: { valid: true, from, found } });
  log?.audit({
    action: "marketing.unsubscribe",
    actor: { type: "user", id: named.userId },
    target: { type: "user", id: named.userId },
    outcome: "success",
  });
  const said =
    from === "all"
      ? `You will not get product news or offers from rdyrct any more. ${ACCOUNT_MAIL} Changed your mind? Turn them back on in Settings.`
      : `You will not get ${LIST_COPY[from].name} from rdyrct any more. Changed your mind? ${LIST_COPY[from].again}`;
  return page(200, "Unsubscribed", `<h1>You are unsubscribed</h1><p>${said}</p>`);
});
