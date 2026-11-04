/**
 * Marketing consent (product news and offers), client side. The rules are
 * the server's (worker/marketing.ts); this is the wiring the three places
 * share: the last onboarding step, the one-time dialog and the Settings
 * toggles.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { CurrentUser, MarketingAnswer, MarketingState } from "@/shared/types";

/** The two lists, as one answer from the onboarding step or the dialog. */
export interface ListChoice {
  news: boolean;
  offers: boolean;
}

/** Records an answer, and puts the server's resulting state into the user. */
export function useSetMarketing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answer: MarketingAnswer) =>
      api<MarketingState>("/user/marketing", { method: "PUT", body: answer }),
    onSuccess: (marketing) =>
      qc.setQueryData<CurrentUser | null>(["user"], (current) =>
        current ? { ...current, user: { ...current.user, marketing } } : current,
      ),
  });
}
