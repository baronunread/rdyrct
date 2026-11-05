/**
 * The exit offer on rdyrct.com's marketing pages: when a visitor on a desktop
 * moves the pointer out through the top of the window, a card shows a
 * code for 20% off the first three months of Hobby or Pro.
 *
 * The rules for showing it are one pure function, `exitOfferEligible`, so a
 * unit test can state each of them. The rest of the file is what this
 * browser remembers: when it last showed the card, and whether the visitor
 * has answered it (no thanks, or took the code).
 */
import * as v from "valibot";

const MEMORY_KEY = "rdyrct:exit-offer:v1";

/** How long the card stays away after it was shown once. */
export const EXIT_OFFER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** How long a visitor has been on the site before the card may show. */
export const EXIT_OFFER_MIN_VISIT_MS = 10_000;

/** The narrowest window the card shows in: a desktop, not a tablet. */
const EXIT_OFFER_MIN_WIDTH = 1024;

/** Where the card never shows, on top of the app (which never mounts it):
 * the sign-in and sign-up cards, the setup flow, the legal pages, the docs
 * and the abuse form. A path matches itself and everything under it. */
const NEVER_ON = [
  "/signup",
  "/login",
  "/welcome",
  "/onboarding",
  "/reset-password",
  "/invite",
  "/consent",
  "/privacy",
  "/terms",
  "/docs",
  "/report",
  "/dashboard",
  "/analytics",
  "/links",
  "/domains",
  "/members",
  "/billing",
  "/settings",
  "/organization",
  "/api-keys",
  "/admin",
];

/** What this browser remembers about the card. */
const memorySchema = v.object({
  /** When it was last shown (epoch ms). */
  shownAt: v.number(),
  /** The visitor answered: "No thanks", "See plans", or copied the code.
   * Never again. */
  final: v.boolean(),
});
export type ExitOfferMemory = v.InferOutput<typeof memorySchema>;

export interface ExitOfferContext {
  pathname: string;
  search: string;
  /** `(pointer: fine) and (hover: hover)`: a mouse, not a finger. */
  finePointer: boolean;
  viewportWidth: number;
  signedIn: boolean;
  /** The deployment runs the offer (`AppConfig.exitOfferCode`). */
  enabled: boolean;
  /** How long this page load has been open. */
  msOnSite: number;
  memory: ExitOfferMemory | null;
  now: number;
}

function onPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Whether the card may show now. Each rule is one line, and each has a
 * unit test (tests/exit-offer.test.ts). */
export function exitOfferEligible(ctx: ExitOfferContext): boolean {
  if (!ctx.enabled || ctx.signedIn) return false;
  if (!ctx.finePointer || ctx.viewportWidth < EXIT_OFFER_MIN_WIDTH) return false;
  if (NEVER_ON.some((path) => onPath(ctx.pathname, path))) return false;
  // A pricing link mid-way to checkout: the visitor is already buying.
  if (onPath(ctx.pathname, "/pricing") && /[?&](plan|checkout)=/.test(ctx.search)) return false;
  if (ctx.msOnSite < EXIT_OFFER_MIN_VISIT_MS) return false;
  if (ctx.memory?.final) return false;
  if (ctx.memory && ctx.now - ctx.memory.shownAt < EXIT_OFFER_COOLDOWN_MS) return false;
  return true;
}

/** Whether a mouse leaving the page went toward the browser's tabs: out
 * through the top (tabs and address bar) or a side (vertical tabs sit on the
 * left or the right). The right edge counts only past the scrollbar, so
 * reaching for it is not leaving. The bottom is the Dock or the taskbar:
 * just moving around. */
export function leftTowardTabs(
  event: { clientX: number; clientY: number; relatedTarget: EventTarget | null },
  viewportWidth: number,
): boolean {
  if (event.relatedTarget !== null) return false;
  return event.clientY <= 0 || event.clientX <= 0 || event.clientX >= viewportWidth - 1;
}

export function readExitOfferMemory(): ExitOfferMemory | null {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return null;
    const parsed = v.safeParse(memorySchema, JSON.parse(raw));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

function remember(memory: ExitOfferMemory) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Storage off: the card may show again next visit, which is all it costs.
  }
}

/** The card was shown: it stays away for 30 days. */
export function rememberExitOfferShown(now: number = Date.now()) {
  remember({ shownAt: now, final: readExitOfferMemory()?.final ?? false });
}

/** The visitor answered the card (no thanks, or took the code): never show
 * it again in this browser. */
export function rememberExitOfferFinal(now: number = Date.now()) {
  const memory = readExitOfferMemory();
  if (memory?.final) return;
  remember({ shownAt: memory?.shownAt ?? now, final: true });
}
