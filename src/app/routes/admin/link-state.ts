/**
 * One state per link row, the worst one, so the row stays one line.
 *
 * A link can be on a blocklist, held by an admin, behind a warning page, and
 * scored, all at once. The admin table used to print each as its own badge
 * with its reason under it, which made rows three lines tall and put the risk
 * verdict and the moderation state in one column as if they were one fact.
 * Now the badge names the worst state, and its tooltip (and the row menu, for
 * a phone, which has no hover) lists all of them with their reasons.
 */

/** What the state is read from. Anonymous links have no hold or warning, so
 * those fields are optional. */
export type StateInput = {
  riskScore: number | null;
  riskReasons: string[];
  suspendedAt?: number | null;
  suspendReason?: string | null;
  warnedAt?: number | null;
  warnReason?: string | null;
};

/** Worst first. The index is the sort key, so an ascending sort puts the
 * links that need someone at the top. */
const ORDER = ["blocked", "suspended", "warning", "risky", "clean", "unscored"] as const;
export type LinkState = (typeof ORDER)[number];

/** "web_risk_social_engineering" reads "Google: social engineering". */
const riskLabel = (reason: string) =>
  reason === "dns_blocklist"
    ? "DNS blocklist"
    : reason.startsWith("web_risk_")
      ? `Google: ${reason.slice("web_risk_".length).replaceAll("_", " ")}`
      : reason;

/**
 * Null is not zero. An unscored link is one nobody has looked at, and showing
 * it as "clean" is how a provider outage turns into a table of green ticks.
 * Today's checkers answer 0 or 100; anything between is "risky".
 */
function riskState(score: number | null): LinkState {
  if (score === null) return "unscored";
  if (score >= 100) return "blocked";
  return score > 0 ? "risky" : "clean";
}

export function linkState(link: StateInput): LinkState {
  const risk = riskState(link.riskScore);
  if (risk === "blocked") return risk;
  if (link.suspendedAt) return "suspended";
  if (link.warnedAt) return "warning";
  return risk;
}

/** Sort key for the State column: worst first on an ascending sort. */
export const linkStateRank = (link: StateInput) => ORDER.indexOf(linkState(link));

const why = (reason: string | null | undefined) => reason || "no reason given";

/** Every fact behind the badge, in the order the badge ranks them, e.g.
 * "Suspended: Phishing report, ticket 412 · Risk: clean". */
export function linkStateDetail(link: StateInput): string {
  const risk = riskState(link.riskScore);
  const blocked = `Blocked: ${link.riskReasons.map(riskLabel).join(", ") || "on a blocklist"}`;
  return [
    risk === "blocked" ? blocked : null,
    link.suspendedAt ? `Suspended: ${why(link.suspendReason)}` : null,
    link.warnedAt ? `Warning: ${why(link.warnReason)}` : null,
    risk === "blocked" ? null : `Risk: ${risk}`,
  ]
    .filter((fact) => fact !== null)
    .join(" · ");
}
