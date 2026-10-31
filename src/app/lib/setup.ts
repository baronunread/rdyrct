import { useSyncExternalStore } from "react";
import * as v from "valibot";
import { PLAN_PRICES, PLAN_PRICES_YEARLY } from "@/shared/types";

/**
 * A new organization's setup list: plan, first link, own domain, team.
 *
 * What each step needs is read from live data (a link exists, a domain
 * exists, somebody else is in the org), so the only thing kept here is what
 * the data cannot say: that this browser started the list for this org, which
 * steps the owner put off, the plan they came in for, and that the list is
 * over. Kept per browser on purpose: it is a welcome, not a record, and an
 * account that already has links never starts one (see `useStartSetup`).
 */

const SETUP_STEPS = ["plan", "link", "domain", "team"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

const PlanIntent = v.object({
  target: v.picklist(["hobby", "pro"]),
  interval: v.picklist(["month", "year"]),
});
export type PlanIntent = v.InferOutput<typeof PlanIntent>;

const OrgSetup = v.object({
  later: v.array(v.picklist(SETUP_STEPS)),
  plan: v.optional(PlanIntent),
  finished: v.optional(v.boolean()),
});
export type OrgSetup = v.InferOutput<typeof OrgSetup>;

const Stored = v.record(v.string(), OrgSetup);

const KEY = "rdyrct:setup:v1";
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

/** Starts the list for an org, once. A plan intent, when given, is kept even
 * if the list already started: the welcome screen hands it over after a
 * checkout. */
export function startSetup(orgId: string, plan?: PlanIntent) {
  const current = read()[orgId];
  if (current && (!plan || current.plan)) return;
  write(orgId, (s) => ({ later: s?.later ?? [], finished: s?.finished, plan: plan ?? s?.plan }));
}

export function putOff(orgId: string, step: SetupStep) {
  write(orgId, (s) => ({
    later: [...new Set([...(s?.later ?? []), step])],
    plan: s?.plan,
    finished: s?.finished,
  }));
}

export function finishSetup(orgId: string) {
  write(orgId, (s) => ({ later: s?.later ?? [], plan: s?.plan, finished: true }));
}

/** Reads `plan` and `interval` off a URL's search, as the pricing links and
 * the checkout return write them. Null when it names no paid plan. */
export function planIntentFrom(search: URLSearchParams): PlanIntent | null {
  const parsed = v.safeParse(PlanIntent, {
    target: search.get("plan"),
    interval: search.get("interval") ?? "month",
  });
  return parsed.success ? parsed.output : null;
}

export const PLAN_NAME = { hobby: "Hobby", pro: "Pro" } as const;

/** "$9 a month", or "$8.10 a month, billed yearly". */
export function priceLine(intent: PlanIntent): string {
  return intent.interval === "year"
    ? `${PLAN_PRICES_YEARLY[intent.target]} a month, billed yearly`
    : `${PLAN_PRICES[intent.target]} a month`;
}
