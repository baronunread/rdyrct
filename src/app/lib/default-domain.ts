import type { DomainDTO } from "@/shared/types";

// The stored id is a preference, not a promise: the domain may since have been deleted, gone
// back to `checking_dns`, or left the plan's reach. Then the shared domain is the answer.
// `activeDomains` already filters for all of those, so membership is the whole check.
export function resolveDefaultDomainId(
  defaultDomainId: string | null | undefined,
  activeDomains: DomainDTO[],
): string | null {
  if (!defaultDomainId) return null;
  return activeDomains.some((d) => d.id === defaultDomainId) ? defaultDomainId : null;
}
