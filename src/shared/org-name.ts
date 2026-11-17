/** A default name for somebody's first organization (#65), so nobody is asked for one first. */

const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
  "duck.com",
]);

export function workDomain(email: string): string | null {
  const domain = email
    .slice(email.lastIndexOf("@") + 1)
    .trim()
    .toLowerCase();
  return email.includes("@") && domain.includes(".") && !CONSUMER_EMAIL_DOMAINS.has(domain)
    ? domain
    : null;
}

const MAX_LENGTH = 100;

function titleCase(value: string): string {
  return value
    .split(/[.\-_+]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function defaultOrgName(email: string, accountName?: string): string {
  const at = email.lastIndexOf("@");
  const domain =
    at === -1
      ? ""
      : email
          .slice(at + 1)
          .trim()
          .toLowerCase();
  const local = at === -1 ? email.trim() : email.slice(0, at).trim();

  // Strip only the last label: "acme.co.uk" reads "Acme Co". Multi-part suffixes would need a table.
  if (domain && !CONSUMER_EMAIL_DOMAINS.has(domain)) {
    const withoutTld = domain.split(".").slice(0, -1).join(".");
    const named = titleCase(withoutTld || domain);
    if (named) return named.slice(0, MAX_LENGTH);
  }

  const person = (accountName ?? "").trim() || titleCase(local);
  return (person ? `${person}'s links` : "My links").slice(0, MAX_LENGTH);
}
