/** Whether checkout should hand the customer to their first link.
 * An existing org is empty only after its quota query says so. */
export function shouldOfferFirstLink(
  org: { id: string } | null,
  linkQuotaCount: number | undefined,
): boolean {
  if (!org) return true;
  return linkQuotaCount === 0;
}
