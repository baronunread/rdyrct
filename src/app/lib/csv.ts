/**
 * CSV for the analytics export (#78).
 *
 * Built here, from data the page already holds, so an export costs no
 * request and no D1 read. That also settles the plan cap for free: the rows
 * on screen are the rows the server already trimmed to the org's
 * analyticsDays, so an export cannot reach further back than the UI does.
 */

import type { SeriesPoint, TopEntry } from "@/shared/types";

/** One field, quoted only when it has to be. */
function field(value: string): string {
  // A leading =, +, - or @ is a formula to Excel and Sheets, so a referrer
  // like "=cmd|..." would run on open. Prefixing a quote makes it text.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  // CRLF, which is what RFC 4180 says and what Excel wants.
  return rows.map((row) => row.map(field).join(",")).join("\r\n");
}

/**
 * Hand the file to the browser.
 *
 * A blob URL rather than a data: URL: the strict CSP forbids the second, and
 * a download of unknown size should not sit in an attribute anyway.
 */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM is what makes Excel read it as UTF-8 rather than the local
  // codepage, which otherwise mangles every non-ASCII country name.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface ExportableStats {
  series: SeriesPoint[];
  countries: TopEntry[];
  referrers: TopEntry[];
  devices: TopEntry[];
}

/**
 * One file, not four: a `section` column keeps the time series and the three
 * breakdowns together, which is what somebody assembling a campaign summary
 * wants to open. Sections are named in the singular so a spreadsheet filter
 * reads as a sentence.
 */
export function statsToCsv(stats: ExportableStats): string {
  const sections: [string, { key: string; clicks: number }[]][] = [
    ["date", stats.series.map((point) => ({ key: point.day, clicks: point.clicks }))],
    ["country", stats.countries],
    ["device", stats.devices],
    ["referrer", stats.referrers],
  ];
  const rows: string[][] = [["section", "key", "clicks"]];
  for (const [section, entries] of sections)
    for (const entry of entries) rows.push([section, entry.key, String(entry.clicks)]);
  return toCsv(rows);
}

/** `rdyrct-analytics-30d-2026-08-08.csv`, so a folder of exports sorts and
 * reads without opening any of them. */
export function statsFilename(scope: string, days: number): string {
  const today = new Date().toISOString().slice(0, 10);
  return `rdyrct-${scope}-${days}d-${today}.csv`;
}
