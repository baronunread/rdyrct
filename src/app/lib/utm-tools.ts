import { UTM_KEYS, buildDestination, resolveUtm, stripUtmParams } from "@/shared/utm";
import type { UtmFields } from "@/shared/utm";
import { toCsv } from "@/shared/csv";

const withScheme = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

export function webAddress(value: string): URL | null {
  try {
    const url = new URL(withScheme(value.trim()));
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

export function splitTagged(value: string, fields: UtmFields) {
  const url = webAddress(value);
  if (!url || !UTM_KEYS.some(([param]) => url.searchParams.has(param))) return null;
  return { address: stripUtmParams(url.toString()), fields: resolveUtm(url.toString(), fields) };
}

export function taggedUrl(value: string, fields: UtmFields): string | null {
  const url = webAddress(value);
  if (!url) return null;
  return buildDestination(stripUtmParams(url.toString()), resolveUtm("", fields));
}

export const tidy = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "-");

export interface UtmChannel {
  label: string;
  source: string;
  medium: string;
}

export const PRESETS = [
  { label: "Newsletter", source: "newsletter", medium: "email" },
  { label: "Instagram", source: "instagram", medium: "social" },
  { label: "LinkedIn", source: "linkedin", medium: "social" },
  { label: "Google Ads", source: "google", medium: "cpc" },
  { label: "Print QR", source: "print", medium: "qr" },
] as const satisfies readonly UtmChannel[];

export const MAX_BULK_LINKS = 500;

export interface BulkLink {
  address: string;
  fields: UtmFields;
  tagged: string;
}

export interface BulkResult {
  links: BulkLink[];
  badLines: number[];
  taggedLines: number[];
  capped: boolean;
}

export function bulkLinks(text: string, channels: readonly UtmChannel[], fields: UtmFields) {
  const pairs = linkChannels(channels, fields);
  const result: BulkResult = { links: [], badLines: [], taggedLines: [], capped: false };
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const url = webAddress(line);
    if (!url) return void result.badLines.push(index + 1);
    const address = stripUtmParams(url.toString());
    if (address !== url.toString()) result.taggedLines.push(index + 1);
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

export function linkChannels(channels: readonly UtmChannel[], fields: UtmFields): UtmChannel[] {
  const typed = { label: "", source: fields.utmSource.trim(), medium: fields.utmMedium.trim() };
  if (!channels.length) return [typed];
  return uniqueChannels(typed.source ? [...channels, typed] : channels);
}

export function typedChannelNote(channels: readonly UtmChannel[], fields: UtmFields) {
  const source = fields.utmSource.trim();
  const medium = fields.utmMedium.trim();
  if (!channels.length) return null;
  if (source)
    return `Also one link each for ${[source, medium].filter(Boolean).join(" / ")}, from the fields below.`;
  return medium ? `Medium “${medium}” is not used: each channel sets its own.` : null;
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

export function bulkFilename(): string {
  return `utm-links-${new Date().toISOString().slice(0, 10)}.csv`;
}
