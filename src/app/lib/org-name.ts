/**
 * A default name for somebody's first organization (#65).
 *
 * The empty state used to ask for this before anything else could happen,
 * which is the activation cliff that issue is about: a person who came to
 * shorten a link was asked to name a company first. Naming it for them is
 * only defensible because it is trivially renameable in Settings, and the
 * state says so.
 *
 * Derived from the email domain when that domain looks like an organization,
 * because "acme.com" is a much better guess than anything else available.
 * Consumer providers say nothing about who somebody works for, so those fall
 * back to the account name.
 */

/** Domains that identify a person, not an organization. Deliberately short:
 * a miss only costs a slightly worse default name that is one edit away. */
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

const MAX_LENGTH = 100;

/** "acme-supply" and "acme_supply" read as one word; a name should not. */
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

  // A work domain names the organization. Strip only the public suffix's last
  // label: "acme.co.uk" should read "Acme Co", not "Acme", and guessing at
  // multi-part suffixes is not worth the table it would need.
  if (domain && !CONSUMER_EMAIL_DOMAINS.has(domain)) {
    const withoutTld = domain.split(".").slice(0, -1).join(".");
    const named = titleCase(withoutTld || domain);
    if (named) return named.slice(0, MAX_LENGTH);
  }

  // A consumer address says nothing about an employer, so use whoever they
  // are, and fall back to the address's local part when there is no name.
  const person = (accountName ?? "").trim() || titleCase(local);
  return (person ? `${person}'s links` : "My links").slice(0, MAX_LENGTH);
}
