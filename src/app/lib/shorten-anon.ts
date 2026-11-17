import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { TurnstileGuard } from "./turnstile";
import { TURNSTILE_TOKEN_HEADER } from "@/shared/types";

export type AnonLink = { slug: string; url: string; claimToken: string; expiresAt: number };

// `guarded` re-solves and retries once if the Worker turns the token down (#304).
export async function shortenAnonymously(
  destination: string,
  guarded: TurnstileGuard,
): Promise<AnonLink> {
  return guarded((headers) =>
    api<AnonLink>("/shorten", {
      method: "POST",
      body: { destination, turnstileToken: headers[TURNSTILE_TOKEN_HEADER] ?? "" },
    }),
  );
}

export function useAnonClicks(link: { claimToken: string } | undefined): number | undefined {
  const { data } = useQuery({
    queryKey: ["anon-clicks", link?.claimToken],
    enabled: link !== undefined,
    queryFn: () =>
      api<{ clicks: number }>("/shorten/clicks", {
        headers: { "x-claim-token": link?.claimToken ?? "" },
      }),
    refetchInterval: 15_000,
    retry: false,
  });
  return data?.clicks;
}

export function clicksLabel(n: number): string {
  return n === 1 ? "1 click" : `${n} clicks`;
}
