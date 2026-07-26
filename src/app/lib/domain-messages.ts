import type { DomainDTO } from "@/shared/types";

export function addDomainMessage(status: DomainDTO["status"]): string {
  if (status === "active") return "Domain added successfully";
  if (status === "issuing_tls") return "Domain added, DNS resolved, issuing certificate…";
  return "Domain added, checking DNS…";
}

/** The recheck toast: null when there's nothing worth telling the user
 * (e.g. still checking_dns with no change). */
export function recheckMessage(
  oldStatus: DomainDTO["status"],
  newStatus: DomainDTO["status"],
): string | null {
  if (newStatus === oldStatus) {
    if (oldStatus === "checking_dns")
      return "CNAME record not detected yet: create it at your DNS provider to continue";
    if (oldStatus === "issuing_tls")
      return "Certificate still being issued, usually takes a few minutes";
    return null;
  }
  if (newStatus === "active") return "Domain is live!";
  if (oldStatus === "checking_dns" && newStatus === "issuing_tls")
    return "DNS resolved! Issuing TLS certificate…";
  return null;
}
