import { useSyncExternalStore } from "react";
import * as v from "valibot";
import { PLAN_PRICES, PLAN_PRICES_YEARLY } from "@/shared/types";

/**
 * A new organization's setup flow (components/setup-flow.tsx): its name, its
 * first link, a domain of its own, its team.
 *
 * Kept per browser, and only what the server cannot say: that this browser
 * started the flow for this org, the step it was on (a checkout from the
 * domain step comes back to it), the plan somebody came in for, and that the
 * flow is over. It is a welcome, not a record: an account that already has
 * links never starts one (see useWelcomeList).
 */

const FLOW_STEPS = ["name", "link", "domain", "team"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

const PlanIntent = v.object({
  target: v.picklist(["hobby", "pro"]),
  interval: v.picklist(["month", "year"]),
});
export type PlanIntent = v.InferOutput<typeof PlanIntent>;

const OrgSetup = v.object({
  at: v.optional(v.picklist(FLOW_STEPS)),
  plan: v.optional(PlanIntent),
  finished: v.optional(v.boolean()),
  /** The domain typed before a checkout, added once the plan is paid. */
  host: v.optional(v.string()),
  /** The domain step sent them to checkout: Polar's way back resumes the
   * flow on that step instead of showing a card of its own. */
  paying: v.optional(v.boolean()),
  /** The owner closed the sidebar's setup list (components/setup-checklist.tsx). */
  listHidden: v.optional(v.boolean()),
});
export type OrgSetup = v.InferOutput<typeof OrgSetup>;

const Stored = v.record(v.string(), OrgSetup);

const KEY = "rdyrct:setup:v2";
const EVENT = "rdyrct:setup";

let cache: { raw: string | null; value: Record<string, OrgSetup> } | null = null;

function read(): Record<string, OrgSetup> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return {};
  }
  // useSyncExternalStore needs the same object back while nothing changed.
  if (cache && cache.raw === raw) return cache.value;
  let value: Record<string, OrgSetup> = {};
  if (raw) {
    try {
      const parsed = v.safeParse(Stored, JSON.parse(raw));
      if (parsed.success) value = parsed.output;
    } catch {
      // A hand-edited or truncated value reads as nothing started.
    }
  }
  cache = { raw, value };
  return value;
}

function write(orgId: string, update: (current: OrgSetup | undefined) => OrgSetup) {
  const all = { ...read(), [orgId]: update(read()[orgId]) };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode or a full quota: the list just does not remember.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** This org's setup in this browser, or undefined when it never started. */
export function useOrgSetup(orgId: string): OrgSetup | undefined {
  return useSyncExternalStore(
    subscribe,
    () => read()[orgId],
    () => undefined,
  );
}

/** Starts the flow for an org, once. A plan intent, when given, is kept even
 * if it already started: the welcome screen hands it over after a checkout. */
export function startSetup(orgId: string, plan?: PlanIntent) {
  const current = read()[orgId];
  if (current && (!plan || current.plan)) return;
  write(orgId, (s) => ({ ...s, plan: plan ?? s?.plan }));
}

/** The step the flow is on, so a trip to checkout comes back to it. */
export function setupAt(orgId: string, at: FlowStep) {
  // Only a flow that started: the page draws the flow before it knows the
  // org gets one, and drawing it must not be what starts it.
  const current = read()[orgId];
  if (!current || current.at === at) return;
  // Past the domain step, a checkout it opened is behind them.
  write(orgId, (s) => ({ ...s, at, paying: at === "domain" ? s?.paying : undefined }));
}

export function finishSetup(orgId: string) {
  write(orgId, (s) => ({ ...s, finished: true }));
}

/** Keeps the domain and plan the domain step was paying for, so the flow
 * can add the domain when Polar sends them back. */
export function keepForCheckout(orgId: string, host: string, plan: PlanIntent) {
  write(orgId, (s) => ({ ...s, host: host || undefined, plan, paying: true }));
}

/** Whether a flow in this browser is out at a checkout its domain step
 * opened. Read before the org is known, so it asks of every org kept: a
 * browser has one new organization in setup at a time. */
export function flowAtCheckout(): boolean {
  return Object.values(read()).some((s) => s.paying && !s.finished);
}

export function hideSetupList(orgId: string) {
  write(orgId, (s) => ({ ...s, listHidden: true }));
}

export function showSetupList(orgId: string) {
  write(orgId, (s) => ({ ...s, listHidden: false }));
}

/** Reads `plan` and `interval` off a URL's search, as the pricing links and
 * the checkout return write them. Null when it names no paid plan. */
export function planIntentFrom(search: URLSearchParams): PlanIntent | null {
  // A plan worth keeping with a cycle nobody can read is still that plan,
  // monthly: dropping it would skip checkout without a word.
  const interval = search.get("interval") === "year" ? "year" : "month";
  const parsed = v.safeParse(PlanIntent, { target: search.get("plan"), interval });
  return parsed.success ? parsed.output : null;
}

export const PLAN_NAME = { hobby: "Hobby", pro: "Pro" } as const;

/** "$9 a month", or "$8.10 a month, billed yearly". */
export function priceLine(intent: PlanIntent): string {
  return intent.interval === "year"
    ? `${PLAN_PRICES_YEARLY[intent.target]} a month, billed yearly`
    : `${PLAN_PRICES[intent.target]} a month`;
}
