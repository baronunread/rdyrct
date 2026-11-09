/**
 * What the free UTM builder (/utm-builder) computes, apart from the page: the
 * one-link builder, the many-links builder and the saved templates all read
 * an address and a set of tags the same way.
 */
import { UTM_KEYS, buildDestination, resolveUtm, stripUtmParams } from "@/shared/utm";
import type { UtmFields } from "@/shared/utm";
import { toCsv } from "@/shared/csv";

const withScheme = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

/** A web address as typed, with https:// added when it has no scheme, or
 *  null when it is not one. Same rule the shortener applies. */
export function webAddress(value: string): URL | null {
  try {
    const url = new URL(withScheme(value.trim()));
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

/** A pasted link that is already tagged: its address without the tags, and
 *  the fields filled from them (its own values win). Null when untagged. */
export function splitTagged(value: string, fields: UtmFields) {
  const url = webAddress(value);
  if (!url || !UTM_KEYS.some(([param]) => url.searchParams.has(param))) return null;
  return { address: stripUtmParams(url.toString()), fields: resolveUtm(url.toString(), fields) };
}

/** The tagged address, or null until there is a web address to tag. Tags
 *  already on the address give way to the fields, as in the one-link builder,
 *  where pasting a tagged link moves its tags into the fields. */
export function taggedUrl(value: string, fields: UtmFields): string | null {
  const url = webAddress(value);
  if (!url) return null;
  // resolveUtm with no address to read from just trims each field.
  return buildDestination(stripUtmParams(url.toString()), resolveUtm("", fields));
}

/** Lowercase, with hyphens for spaces: one spelling per value. */
export const tidy = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "-");

/** A source and medium pair: where a link goes, as one tap. */
export interface UtmChannel {
  label: string;
  source: string;
  medium: string;
}

/** Where links usually go, as the source and medium most teams use for
 *  each. */
export const PRESETS = [
  { label: "Newsletter", source: "newsletter", medium: "email" },
  { label: "Instagram", source: "instagram", medium: "social" },
  { label: "LinkedIn", source: "linkedin", medium: "social" },
  { label: "Google Ads", source: "google", medium: "cpc" },
  { label: "Print QR", source: "print", medium: "qr" },
] as const satisfies readonly UtmChannel[];

/** How many links the many-links builder makes at once. Past this the list
 *  stops being something to read, and a spreadsheet does it better. */
export const MAX_BULK_LINKS = 500;

export interface BulkLink {
  address: string;
  fields: UtmFields;
  tagged: string;
}

export interface BulkResult {
  links: BulkLink[];
  /** Line numbers (from 1) that are not web addresses. */
  badLines: number[];
  /** True when more links were asked for than MAX_BULK_LINKS. */
  capped: boolean;
}

/**
 * One tagged link per address and channel. With no channel picked, every
 * link uses the source and medium typed in the fields; with some picked, a
 * typed source counts as one more channel. Blank lines are skipped and the
 * same address twice is built once.
 */
export function bulkLinks(text: string, channels: readonly UtmChannel[], fields: UtmFields) {
  const pairs = linkChannels(channels, fields);
  const result: BulkResult = { links: [], badLines: [], capped: false };
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const url = webAddress(line);
    if (!url) return void result.badLines.push(index + 1);
    const address = stripUtmParams(url.toString());
    if (seen.has(address)) return;
    seen.add(address);
    for (const pair of pairs) {
      if (result.links.length >= MAX_BULK_LINKS) return void (result.capped = true);
      const linkFields = { ...fields, utmSource: pair.source, utmMedium: pair.medium };
      const tagged = taggedUrl(address, linkFields);
      if (tagged) result.links.push({ address, fields: resolveUtm("", linkFields), tagged });
    }
  });
  return result;
}

/** The channels a set of links is built for: the picked ones plus the typed
 *  source and medium, each pair once. */
export function linkChannels(channels: readonly UtmChannel[], fields: UtmFields): UtmChannel[] {
  const typed = { label: "", source: fields.utmSource.trim(), medium: fields.utmMedium.trim() };
  if (!channels.length) return [typed];
  return uniqueChannels(typed.source ? [...channels, typed] : channels);
}

export const channelKey = ({ source, medium }: UtmChannel) => `${source}\n${medium}`;

function uniqueChannels(channels: readonly UtmChannel[]): UtmChannel[] {
  const seen = new Set<string>();
  return channels.filter((channel) => {
    const key = channelKey(channel);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The channels the many-links builder offers: the presets, then the source
 *  and medium of each saved template that has a source. */
export function channelOptions(templates: readonly UtmFields[]): UtmChannel[] {
  const saved = templates
    .filter((t) => t.utmSource)
    .map((t) => ({
      label: [t.utmSource, t.utmMedium].filter(Boolean).join(" / "),
      source: t.utmSource,
      medium: t.utmMedium,
    }));
  return uniqueChannels([...PRESETS, ...saved]);
}

/** The links as a spreadsheet: the address, each tag in its own column, then
 *  the tagged link, so a team can sort and filter by any of them. */
export function bulkCsv(links: readonly BulkLink[]): string {
  const header = ["website_url", ...UTM_KEYS.map(([param]) => param), "tagged_url"];
  return toCsv([
    header,
    ...links.map(({ address, fields, tagged }) => [
      address,
      ...UTM_KEYS.map(([, key]) => fields[key]),
      tagged,
    ]),
  ]);
}

/** `utm-links-2026-11-09.csv`, so a folder of exports sorts by day. */
export function bulkFilename(): string {
  return `utm-links-${new Date().toISOString().slice(0, 10)}.csv`;
}
