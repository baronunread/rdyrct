/**
 * The one call to the anonymous shortener (Direction A of #96).
 *
 * Shared by the hero form and the QR generator, which ask for the same thing
 * for different reasons: the hero to show that shortening works, the QR page
 * to make a printed code countable.
 */
import { api } from "./api";

export type AnonLink = { slug: string; url: string; claimToken: string; expiresAt: number };

/** Carries the proof of work solved while the visitor was typing (#98). */
export async function shortenAnonymously(
  destination: string,
  capHeaders: () => Promise<Record<string, string>>,
): Promise<AnonLink> {
  return api<AnonLink>("/shorten", {
    method: "POST",
    body: { destination, capToken: (await capHeaders())["x-cap-token"] ?? "" },
  });
}
