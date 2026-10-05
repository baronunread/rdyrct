/**
 * The one call to the anonymous shortener (Direction A of #96).
 *
 * Shared by the hero form and the QR generator, which ask for the same thing
 * for different reasons: the hero to show that shortening works, the QR page
 * to make a printed code countable.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { CapGuard } from "./cap";
import { CAP_TOKEN_HEADER } from "@/shared/types";

export type AnonLink = { slug: string; url: string; claimToken: string; expiresAt: number };

/**
 * Carries the proof of work solved while the visitor was typing (#98).
 *
 * `guarded` re-solves and retries once if the Worker turns the token down.
 * A token can expire, be spent, or be forgotten by the server, and none of
 * that is the visitor's doing or worth an error message.
 */
export async function shortenAnonymously(
  destination: string,
  guarded: CapGuard,
): Promise<AnonLink> {
  return guarded((headers) =>
    api<AnonLink>("/shorten", {
      method: "POST",
      body: { destination, capToken: headers[CAP_TOKEN_HEADER] ?? "" },
    }),
  );
}

/**
 * The click total of the link this browser made, refreshed while the tab is
 * open, so a visitor who shares it watches the number move. Undefined until
 * the first answer, and for a link that has expired or been claimed.
 */
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

/** "1 click" or "3 clicks". */
export function clicksLabel(n: number): string {
  return n === 1 ? "1 click" : `${n} clicks`;
}
