export type StateInput = {
  riskScore: number | null;
  riskReasons: string[];
  suspendedAt?: number | null;
  suspendReason?: string | null;
  warnedAt?: number | null;
  warnReason?: string | null;
  reportCount?: number;
};

const ORDER = [
  "blocked",
  "suspended",
  "reported",
  "warning",
  "risky",
  "clean",
  "unscored",
] as const;
export type LinkState = (typeof ORDER)[number];

const riskLabel = (reason: string) =>
  reason === "dns_blocklist"
    ? "DNS blocklist"
    : reason.startsWith("web_risk_")
      ? `Google: ${reason.slice("web_risk_".length).replaceAll("_", " ")}`
      : reason;

/** Null is not zero. Showing an unscored link as clean turns a provider outage into a table of green ticks. */
function riskState(score: number | null): LinkState {
  if (score === null) return "unscored";
  if (score >= 100) return "blocked";
  return score > 0 ? "risky" : "clean";
}

export function linkState(link: StateInput): LinkState {
  const risk = riskState(link.riskScore);
  if (risk === "blocked") return risk;
  if (link.suspendedAt) return "suspended";
  // Above the warning: a report on a free org's link sets the warning itself, so "Reported" is the reason.
  if (link.reportCount) return "reported";
  if (link.warnedAt) return "warning";
  return risk;
}

const flaggedByGoogle = (link: StateInput) =>
  riskState(link.riskScore) === "blocked" &&
  link.riskReasons.some((reason) => reason.startsWith("web_risk_"));

export function linkStateWord(link: StateInput): string {
  const state = linkState(link);
  const words = {
    blocked: flaggedByGoogle(link) ? "Flagged by Google" : "Blocklisted",
    suspended: "Suspended",
    reported: "Reported",
    warning: "Warning",
    risky: "Risky",
    clean: "Active",
    unscored: "Active",
  } satisfies Record<LinkState, string>;
  return words[state];
}

export const linkStateRank = (link: StateInput) => ORDER.indexOf(linkState(link));

const why = (reason: string | null | undefined) => reason || "no reason given";

export function linkStateDetail(link: StateInput): string {
  const risk = riskState(link.riskScore);
  const blocked = `Blocked: ${link.riskReasons.map(riskLabel).join(", ") || "on a blocklist"}`;
  return [
    risk === "blocked" ? blocked : null,
    link.suspendedAt ? `Suspended: ${why(link.suspendReason)}` : null,
    link.warnedAt ? `Warning: ${why(link.warnReason)}` : null,
    risk === "blocked" ? null : `Risk: ${risk}`,
    link.reportCount
      ? `${link.reportCount} open ${link.reportCount === 1 ? "report" : "reports"}`
      : null,
  ]
    .filter((fact) => fact !== null)
    .join(" · ");
}
