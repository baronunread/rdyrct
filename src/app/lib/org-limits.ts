import { useMemo } from "react";
import { useCurrentUser, useDomains } from "./hooks";
import { useCurrentOrg } from "./current-org";
import { orgQrFrom } from "./org-qr";
import { resolveDefaultDomainId } from "./default-domain";
import { PLAN_LIMITS, type OrgRole } from "@/shared/types";

/** Platform admins can always see an org's domains; otherwise only its
 * owner or admins can (members can't manage custom domains). */
export function canListOrgDomains(isPlatformAdmin: boolean, role: OrgRole | undefined): boolean {
  return isPlatformAdmin || role === "owner" || role === "admin";
}

/**
 * Whether this role may change anything in the org (#157).
 *
 * A viewer reads everything and writes nothing, so every control that would
 * submit has to be hidden rather than left to fail: the server refuses them
 * with a 403, and a button whose only outcome is an error toast is not a
 * feature. Undefined role means the org has not loaded, which is also not a
 * moment to offer a write.
 */
/**
 * Whether this role may administer the org: domains, members, invites and the
 * org-wide QR defaults, none of which a plain member may touch.
 *
 * Locked-aware for the same reason `canWriteOrg` is (#160): a locked org
 * accepts no writes from anyone, its owner included, so a control that would
 * submit has to be hidden rather than left to 403. Platform admins act as
 * owner everywhere, and the lock still applies to them, because the server
 * refuses their write too.
 */
export function canAdminOrg(
  isPlatformAdmin: boolean | undefined,
  role: OrgRole | undefined,
  locked = false,
): boolean {
  if (locked) return false;
  return !!isPlatformAdmin || role === "owner" || role === "admin";
}

export function canWriteOrg(role: OrgRole | undefined, locked = false): boolean {
  // A locked org is read-only for everyone in it, its owner included (#160).
  // Same answer as a viewer's, so every control already hidden for a viewer
  // is hidden here too, and nothing new has to be threaded through.
  if (locked) return false;
  return role === "owner" || role === "admin" || role === "member";
}

export function useOrgLimits() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const limits = PLAN_LIMITS[org?.plan ?? "free"];
  const canListDomains = canListOrgDomains(!!currentUser.data?.user.isAdmin, org?.role);
  const domains = useDomains(orgId, canListDomains);
  // `lockedAt` as well as `status`: a downgrade leaves a domain `active` and
  // locked, and a locked one takes no new links (#159). Without this the
  // editor kept preselecting it and every default-path create came back 402.
  const activeDomains = useMemo(
    () => (domains.data ?? []).filter((d) => d.status === "active" && d.lockedAt === null),
    [domains.data],
  );
  const orgQr = orgQrFrom(org);
  // Every page that can offer a write already calls this hook, so the answer
  // lives here rather than being re-derived from the role at each control.
  const canWrite = canWriteOrg(org?.role, org?.locked);
  // Resolved here rather than at each call site, so nothing preselects a
  // domain that stopped serving (#69).
  const defaultDomainId = resolveDefaultDomainId(org?.defaultDomainId, activeDomains);
  return {
    org,
    orgId,
    currentUser,
    limits,
    canWrite,
    canListDomains,
    domains,
    activeDomains,
    orgQr,
    defaultDomainId,
  };
}
