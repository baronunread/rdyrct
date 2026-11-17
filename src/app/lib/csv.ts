// Built from data the page holds, so an export costs no request and cannot reach
// further back than the plan-trimmed rows on screen (#78).

import { toCsv } from "@/shared/csv";
import type { SeriesPoint, TopEntry } from "@/shared/types";

// A blob URL: the strict CSP forbids data: URLs.
export function downloadCsv(filename: string, csv: string): void {
  // The BOM makes Excel read UTF-8 rather than the local codepage,
  // which mangles non-ASCII country names.
  downloadBlob(filename, new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
}

export function downloadBlob(filename: string, blob: Blob): void {
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

export function statsFilename(scope: string, days: number): string {
  const today = new Date().toISOString().slice(0, 10);
  return `rdyrct-${scope}-${days}d-${today}.csv`;
}
