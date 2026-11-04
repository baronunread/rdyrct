/**
 * Product news consent, client side. The rules are the server's
 * (worker/marketing.ts); this is the wiring the three places share: the
 * sign-up form's choice, the one-time dialog and the Settings toggle.
 *
 * The sign-up choice is held in sessionStorage until the first signed-in app
 * load sends it. One mechanism for both ways in: Google sign-up is a full-page
 * redirect, so nothing in memory survives it, and email sign-up has a code
 * step and a possible reload in the middle. A tab-scoped, short-lived key
 * survives all of that without putting the choice in a URL, and a key that is
 * old or from a login page is dropped. The server decides whether it still
 * applies: it only takes a sign-up answer from an account that has not
 * answered, so a stray one cannot overwrite a real decision.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as v from "valibot";
import { api } from "./api";
import type { CurrentUser, MarketingSource, MarketingState } from "@/shared/types";

const KEY = "rdyrct:marketingChoice";
const MAX_AGE_MS = 60 * 60 * 1000;

const choiceSchema = v.object({ optIn: v.boolean(), at: v.number() });

/** The sign-up form's box, kept for the first signed-in load. */
export function rememberSignupChoice(optIn: boolean) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ optIn, at: Date.now() }));
  } catch {
    /* storage off: the dialog asks later instead */
  }
}

export function forgetSignupChoice() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** The remembered choice, or null when there is none or it has gone stale. */
export function peekSignupChoice(): boolean | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = v.safeParse(choiceSchema, JSON.parse(raw));
    return parsed.success && Date.now() - parsed.output.at < MAX_AGE_MS
      ? parsed.output.optIn
      : null;
  } catch {
    return null;
  }
}

/** Records an answer, and puts the server's resulting state into the user. */
export function useSetMarketing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answer: { optIn: boolean; source: MarketingSource }) =>
      api<MarketingState>("/user/marketing", { method: "PUT", body: answer }),
    onSuccess: (marketing) =>
      qc.setQueryData<CurrentUser | null>(["user"], (current) =>
        current ? { ...current, user: { ...current.user, marketing } } : current,
      ),
  });
}
