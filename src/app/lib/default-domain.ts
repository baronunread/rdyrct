import type { DomainDTO } from "@/shared/types";

/**
 * Which domain a new link should start on (#69).
 *
 * The stored id is a preference, not a promise. Between the moment it was
 * set and the moment someone opens the link editor, the domain can have been
 * deleted, dropped back to `checking_dns` after a DNS change, or slipped out
 * of reach because the org's plan no longer covers custom domains. In every
 * one of those the honest answer is the shared domain: a link is better
 * created at a working address than not created at all.
 *
 * `activeDomains` already carries all three rules, since it is the org's
 * domains filtered to `status === "active"` and only fetched for a plan and
 * role that may have them (`useOrgLimits`). So membership in that list is the
 * whole check.
 */
export function resolveDefaultDomainId(
  defaultDomainId: string | null | undefined,
  activeDomains: DomainDTO[],
): string | null {
  if (!defaultDomainId) return null;
  return activeDomains.some((d) => d.id === defaultDomainId) ? defaultDomainId : null;
}
