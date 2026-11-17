/**
 * Presets match each service's export header by name, ignoring case, spaces and underscores: none
 * publishes its header and they change (Bitly names one column two ways). Rebrandly's shortUrl has no scheme.
 */

export type ImportServiceId = "shortio" | "bitly" | "rebrandly" | "dub" | "csv";

export interface ImportService {
  id: ImportServiceId;
  name: string;
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

export interface ColumnMap {
  shortUrl: number | null;
  /** A custom short URL that, when filled in, replaces `shortUrl` (Bitly). */
  customShortUrl: number | null;
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

export function isComplete(map: ColumnMap): boolean {
  const address = map.shortUrl !== null || (map.domain !== null && map.slug !== null);
  return address && map.destination !== null;
}

/** RFC 4180 CSV. The delimiter is the one of comma, semicolon or tab the first line holds most of: European locales save semicolons. */
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

export interface ImportRow {
  line: number;
  host: string;
  slug: string;
  destination: string;
  title: string;
}

export interface UnreadableRow {
  line: number;
  reason: string;
}

function cell(row: string[], index: number | null): string {
  if (index === null) return "";
  const value = (row[index] ?? "").trim();
  return /^'[=+\-@\t\r\n]/.test(value) ? value.slice(1) : value;
}

/** The slug is kept as written, case too: the Worker decides whether we can serve it. */
export function splitShortUrl(value: string): { host: string; slug: string } | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return { host: url.hostname.toLowerCase(), slug: url.pathname.replace(/^\/+|\/+$/g, "") };
  } catch {
    return null;
  }
}

export interface ReadResult {
  rows: ImportRow[];
  unreadable: UnreadableRow[];
}

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

export function hostsOf(rows: ImportRow[]): string[] {
  return [...new Set(rows.map((row) => row.host))];
}

/** A check binds every slug into one query (D1 takes 100 bound parameters); an import writes two statements a row.
 * Both must fit the 32 KB body limit every org route has. */
export const CHECK_CHUNK_ROWS = 50;
export const IMPORT_CHUNK_ROWS = 20;

export interface LinkImportDTO {
  id: string;
  service: string;
  status: "uploading" | "running" | "done" | "dismissed";
  total: number;
  pending: number;
  imported: number;
  exists: number;
  failed: number;
  hosts: string[];
  failures: { line: number; host: string; slug: string; reason: string }[];
}

interface PastImport {
  id: string;
  service: string;
  imported: number;
  exists: number;
  failed: number;
  finishedAt: number;
}

export interface LinkImportHistory {
  imports: PastImport[];
}

export interface ImportVerdict {
  line: number;
  status: "ready" | "exists" | "imported" | "failed";
  reason?: string;
}

const CHUNK_BYTES = 30_000;

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
