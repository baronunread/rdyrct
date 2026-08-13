/**
 * The one call to the anonymous shortener (Direction A of #96).
 *
 * Shared by the hero form and the QR generator, which ask for the same thing
 * for different reasons: the hero to show that shortening works, the QR page
 * to make a printed code countable.
 */
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
