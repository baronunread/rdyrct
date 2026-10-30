import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as v from "valibot";

/**
 * Which spec files one CI shard runs, chosen by how long each file takes.
 *
 * Playwright's own `--shard` cuts the suite into equal counts of tests in
 * file-path order, and the slow specs (admin, abuse, sign-up) sort to the
 * front: one shard ran 267s while another ran 43s, and the slowest shard is
 * the wall time. Playwright 1.64 has no documented way to weight a shard, so
 * the config does it: `E2E_SHARD=2/6` hands the chromium project only the
 * files this function picks. A file filter, so leanest's own selection on a
 * PR still narrows it further.
 *
 * Greedy by duration: the slowest file goes to whichever shard has the least
 * so far. Every shard computes the same answer from the same inputs, so each
 * file runs in exactly one. A file missing from shard-times.json counts as
 * the median, until `bun scripts/e2e-shard-times.ts` refreshes the table from
 * a run's JSON reports.
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
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".pw.ts"))
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
