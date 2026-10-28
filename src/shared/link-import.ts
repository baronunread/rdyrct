/**
 * Reading another service's link export (#383), shared because both sides need
 * it: the browser parses the file and shows the preview, the Worker checks and
 * writes what the browser sends, one chunk at a time.
 *
 * Every service exports a CSV, but none of them publishes its header, and the
 * ones we could confirm change with the export screen (Bitly names the same
 * column two ways). So a preset is instructions for finding the export plus a
 * list of names each column goes by, matched without regard to case, spaces
 * or underscores. A file whose header matches nothing gets a column picker.
 *
 * What is known about each export, and where it came from:
 * - Dub: `Short link,Destination URL,Clicks,Created at` (and optional
 *   columns), read from dubinc/dub's export route. Strings that look like a
 *   spreadsheet formula get a leading `'`, which `cell()` takes back off.
 * - Bitly: "Link, Custom Link, Date created, Title, Destination URL,
 *   Engagements, Status" for the whole account, "Bitlink, Custom Bitlink, Long
 *   URL, Clicks, Status" for a selection (support.bitly.com). A custom link,
 *   when there is one, is the address people actually have.
 * - Short.io: "short URLs, original paths, original URLs, titles, ..."
 *   (docs.short.io). Export has to be switched on by their support first.
 * - Rebrandly: no export screen any more; files come from their API recipe
 *   (`id,createdAt,shortUrl,destination`) or the rebrandly-links-export CLI
 *   (`...,shortUrl,domain,slashtag,destination`), where shortUrl has no scheme.
 *
 * None of them exports UTMs as columns: the destination already carries them,
 * and the Worker splits them into the link's UTM fields.
 */

export type ImportServiceId = "shortio" | "bitly" | "rebrandly" | "dub" | "csv";

export interface ImportService {
  id: ImportServiceId;
  name: string;
  /** How to get the file out of that service, one step per line. */
  steps: string[];
}

export const IMPORT_SERVICES: ImportService[] = [
  {
    id: "shortio",
    name: "Short.io",
    steps: [
      "Short.io turns exporting on when you ask its support, so ask them first.",
      "Open Domain settings for your domain and choose Export links.",
      "Short.io emails you the file. Download it and choose it below.",
    ],
  },
  {
    id: "bitly",
    name: "Bitly",
    steps: [
      "Exporting needs a paid Bitly plan.",
      "Open Links in the sidebar and choose Export, then Export links.",
      "Bitly emails you the file, which can take half an hour. Download it and choose it below.",
    ],
  },
  {
    id: "rebrandly",
    name: "Rebrandly",
    steps: [
      "Rebrandly no longer has an export screen. Its API exports links to CSV: follow the recipe at developers.rebrandly.com, under Export links to CSV.",
      "Choose the file it writes below.",
    ],
  },
  {
    id: "dub",
    name: "Dub",
    steps: [
      "Open Links, then the ⋮ menu, and choose Export as CSV.",
      "Up to 1,000 links download at once. Dub emails you a larger export.",
      "Choose the file below.",
    ],
  },
  {
    id: "csv",
    name: "Another service",
    steps: [
      "Export your links as a CSV file: one row per link, with the short URL and where it goes.",
      "Choose the file below. If we cannot tell which column is which, you pick them.",
    ],
  },
];

/** Which column holds what, as indexes into a row. */
export interface ColumnMap {
  /** The full short URL, such as `go.example.com/spring` (scheme optional). */
  shortUrl: number | null;
  /** A custom short URL that, when filled in, replaces `shortUrl` (Bitly). */
  customShortUrl: number | null;
  /** Domain and slug in their own columns, for a file with no short URL. */
  domain: number | null;
  slug: number | null;
  destination: number | null;
  title: number | null;
}

const ALIASES = {
  shortUrl: ["shorturl", "shortlink", "link", "bitlink", "secureshorturl", "shortenedurl"],
  customShortUrl: ["customlink", "custombitlink"],
  domain: ["domain", "hostname"],
  slug: ["path", "slashtag", "slug", "key", "backhalf"],
  destination: ["destinationurl", "destination", "originalurl", "longurl", "targeturl", "url"],
  title: ["title", "name"],
} satisfies Record<keyof ColumnMap, string[]>;

const squash = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");

/** The columns a header row names, or null when it names no short URL (or
 * domain and slug) and no destination: then it is not a header we know, and
 * the person picks the columns. */
export function detectColumns(header: string[]): ColumnMap | null {
  const names = header.map(squash);
  const find = (key: keyof ColumnMap) => {
    for (const alias of ALIASES[key]) {
      const index = names.indexOf(alias);
      if (index !== -1) return index;
    }
    return null;
  };
  const map: ColumnMap = {
    shortUrl: find("shortUrl"),
    customShortUrl: find("customShortUrl"),
    domain: find("domain"),
    slug: find("slug"),
    destination: find("destination"),
    title: find("title"),
  };
  return isComplete(map) ? map : null;
}

/** Whether a map can say where each link lives and where it goes. */
export function isComplete(map: ColumnMap): boolean {
  const address = map.shortUrl !== null || (map.domain !== null && map.slug !== null);
  return address && map.destination !== null;
}

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, line breaks inside quotes,
 * CRLF or LF, and a UTF-8 BOM. The delimiter is whichever of comma,
 * semicolon or tab the first line holds most of, since a spreadsheet saved in
 * a European locale writes semicolons. Blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const delimiter = guessDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function guessDelimiter(source: string): string {
  const firstLine = source.slice(0, source.search(/\r?\n|$/));
  const count = (char: string) => firstLine.split(char).length - 1;
  return [",", ";", "\t"].reduce((best, char) => (count(char) > count(best) ? char : best));
}

/** One link as read from the file: where it lives and where it goes. */
export interface ImportRow {
  /** 1-based line in the file, header included, so a person can find it. */
  line: number;
  host: string;
  slug: string;
  destination: string;
  title: string;
}

/** A row that could not even be read, with what to fix. */
export interface UnreadableRow {
  line: number;
  reason: string;
}

/** A cell as the service meant it: trimmed, and without the `'` Dub puts in
 * front of anything a spreadsheet would run as a formula. */
function cell(row: string[], index: number | null): string {
  if (index === null) return "";
  const value = (row[index] ?? "").trim();
  return /^'[=+\-@\t\r\n]/.test(value) ? value.slice(1) : value;
}

/** Host and slug of a short URL, with or without its scheme. The slug is the
 * whole path without its slashes at either end, kept as written (case too):
 * the Worker decides whether we can serve it. */
export function splitShortUrl(value: string): { host: string; slug: string } | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return { host: url.hostname.toLowerCase(), slug: url.pathname.replace(/^\/+|\/+$/g, "") };
  } catch {
    return null;
  }
}

/** A file read as links: the rows that make sense, and the ones that do not. */
export interface ReadResult {
  rows: ImportRow[];
  unreadable: UnreadableRow[];
}

/** The file's rows as links, each either readable or the reason it is not.
 * `firstLine` is the line number of `rows[0]` (2 after a header row). */
export function readRows(rows: string[][], map: ColumnMap, firstLine: number): ReadResult {
  const read: ImportRow[] = [];
  const unreadable: UnreadableRow[] = [];
  rows.forEach((row, index) => {
    const line = firstLine + index;
    const address = addressOf(row, map);
    const destination = cell(row, map.destination);
    if (!address) unreadable.push({ line, reason: "No short URL in this row." });
    else if (!address.slug)
      unreadable.push({ line, reason: "This short URL has no path after the domain." });
    else if (!destination) unreadable.push({ line, reason: "No destination in this row." });
    else read.push({ line, ...address, destination, title: cell(row, map.title) });
  });
  return { rows: read, unreadable };
}

function addressOf(row: string[], map: ColumnMap) {
  const custom = cell(row, map.customShortUrl);
  const short = custom || cell(row, map.shortUrl);
  if (short) return splitShortUrl(short);
  const host = cell(row, map.domain).toLowerCase();
  const slug = cell(row, map.slug).replace(/^\/+|\/+$/g, "");
  return host ? { host, slug } : null;
}

/** The distinct short domains a set of rows lives on, in file order. */
export function hostsOf(rows: ImportRow[]): string[] {
  return [...new Set(rows.map((row) => row.host))];
}

/** The most rows one check request carries, and one import request. A check
 * binds every slug into one query, and D1 takes 100 bound parameters a
 * query; an import writes two statements a row in one D1 batch. Both also
 * have to fit the 32 KB body limit every org route has, which the browser
 * sizes for. */
export const CHECK_CHUNK_ROWS = 50;
export const IMPORT_CHUNK_ROWS = 20;

/** An import as the page follows it (GET /link-import/current). */
export interface LinkImportDTO {
  id: string;
  service: string;
  status: "uploading" | "running" | "done" | "dismissed";
  total: number;
  pending: number;
  imported: number;
  exists: number;
  failed: number;
  /** The short domains its rows live on. */
  hosts: string[];
  /** The first rows that failed, with why. */
  failures: { line: number; host: string; slug: string; reason: string }[];
}

/** One finished import, as the page's "Past imports" lists it. */
interface PastImport {
  id: string;
  service: string;
  imported: number;
  exists: number;
  failed: number;
  /** Epoch ms the import finished. */
  finishedAt: number;
}

/** GET /link-import/history: the org's finished imports, newest first. */
export interface LinkImportHistory {
  imports: PastImport[];
}

/** What the Worker makes of one row. `ready` will import, `exists` is already
 * here exactly (a retry, or an earlier import), `imported` just was. */
export interface ImportVerdict {
  line: number;
  status: "ready" | "exists" | "imported" | "failed";
  /** Why it failed, ready to show. */
  reason?: string;
}

/** Under the 32 KB body limit with room for the JSON around the rows. */
const CHUNK_BYTES = 30_000;

/** Rows in request-sized chunks: at most `maxRows` each, and small enough to
 * send, since one row with a very long destination can be most of a chunk. */
export function chunkRows(rows: ImportRow[], maxRows: number): ImportRow[][] {
  const chunks: ImportRow[][] = [];
  let chunk: ImportRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length + 1;
    if (chunk.length && (chunk.length >= maxRows || bytes + size > CHUNK_BYTES)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(row);
    bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
