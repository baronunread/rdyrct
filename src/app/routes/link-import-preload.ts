import type { QueryClient } from "@tanstack/react-query";
import { domainsQuery, linkImportQuery, linkQuotaUsageQuery } from "../lib/hooks";
import { settle, type PageContext } from "../lib/route-preload";

/**
 * The import page's first render: the import the server already has (which
 * decides between the form and the job), the link quota the form counts
 * against, and the domains an admin can import onto. Its own module so the
 * route can fetch these without pulling in the page, which is large.
 */
export function preload(qc: QueryClient, orgId: string, page: PageContext) {
  const admin = page.org.role === "owner" || page.org.role === "admin";
  return settle([
    qc.ensureQueryData(linkImportQuery(orgId)),
    qc.ensureQueryData(linkQuotaUsageQuery(orgId)),
    admin ? qc.ensureQueryData(domainsQuery(orgId)) : undefined,
  ]);
}
