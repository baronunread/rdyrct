import type { QueryClient } from "@tanstack/react-query";
import { domainsQuery, linkImportQuery, linkQuotaUsageQuery } from "../lib/hooks";
import { settle, type PageContext } from "../lib/route-preload";

export function preload(qc: QueryClient, orgId: string, page: PageContext) {
  const admin = page.org.role === "owner" || page.org.role === "admin";
  return settle([
    qc.ensureQueryData(linkImportQuery(orgId)),
    qc.ensureQueryData(linkQuotaUsageQuery(orgId)),
    admin ? qc.ensureQueryData(domainsQuery(orgId)) : undefined,
  ]);
}
