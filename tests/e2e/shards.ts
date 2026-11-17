import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as v from "valibot";

/**
 * Playwright's --shard splits by test count in path order, so slow specs bunched in one shard
 * (267s against 43s). This is greedy by duration instead; a file missing from
 * shard-times.json counts as the median.
 */
export function shardFiles(dir: string, shard: string): string[] {
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const current = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || current < 1 || current > total)
    throw new Error(`E2E_SHARD="${shard}": expected current/total, like 2/6`);

  const times = v.parse(
    v.record(v.string(), v.number()),
    JSON.parse(readFileSync(path.join(dir, "shard-times.json"), "utf8")),
  );
  const known = Object.values(times).sort((a, b) => a - b);
  const fallback = known[Math.floor(known.length / 2)] ?? 1;
  // Subfolders included, so a spec in a new folder still lands in a shard. production/
  // and self-host/ have configs of their own.
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split(path.sep).join("/"))
    .filter((name) => name.endsWith(".pw.ts") && !/^(production|self-host)\//.test(name))
    .map((name) => ({ name, seconds: times[name] ?? fallback }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));

  const load = Array.from({ length: total }, () => 0);
  const picked: string[] = [];
  for (const file of files) {
    const lightest = load.indexOf(Math.min(...load));
    load[lightest] += file.seconds;
    if (lightest === current - 1) picked.push(file.name);
  }
  return picked;
}
