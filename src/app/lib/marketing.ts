import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { CurrentUser, MarketingAnswer, MarketingState } from "@/shared/types";

export interface ListChoice {
  news: boolean;
  offers: boolean;
}

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
