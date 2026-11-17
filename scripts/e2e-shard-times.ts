/**
 * Refreshes tests/e2e/shard-times.json, the per-file durations the CI shards
 * are balanced on (tests/e2e/shards.ts), from Playwright JSON reports.
 *
 *   bun run e2e:shard-times report.json [more.json ...]
 *
 * Pass every shard's report from one or more CI runs (the e2e job uploads
 * them as the `e2e-timings-*` artifacts); a full-suite run on main refreshes
 * every file, a PR run only the specs leanest picked. A file runs in one
 * shard per run, so it appears in one report per run, and its time is the
 * mean over the reports it appears in: several runs smooth out one slow
 * runner. The weekly `shard-times` workflow does this with main's last five
 * runs. A local run works too, with `--reporter=json` (local runs default to
 * `list`). Only the chromium project counts, and only the first attempt of
 * each test, so a retry does not make a file look slower than it is.
 */
import { existsSync } from "node:fs";

type Suite = {
  file?: string;
  suites?: Suite[];
  specs?: { file: string; tests: { projectName: string; results: { duration: number }[] }[] }[];
};
type Report = { suites: Suite[] };

const out = "tests/e2e/shard-times.json";
const OWN_CONFIG = /^(production|self-host)\//;
const reports = process.argv.slice(2);
if (reports.length === 0) {
  console.error("usage: bun scripts/e2e-shard-times.ts report.json [more.json ...]");
  process.exit(1);
}

type Spec = NonNullable<Suite["specs"]>[number];
const specsOf = (suite: Suite): Spec[] => [
  ...(suite.specs ?? []),
  ...(suite.suites ?? []).flatMap(specsOf),
];

// Merged into the table already there, so a report that covers some files
// (a PR run, one spec) refreshes those and keeps the rest. Files that no
// longer exist drop out.
const previous: Record<string, number> = await Bun.file(out).json();
// Each report's total per file, then the mean over the reports a file is in.
const samples: Record<string, number[]> = {};
for (const path of reports) {
  const report: Report = await Bun.file(path).json();
  // production/ and self-host/ have configs of their own.
  const specs = report.suites.flatMap(specsOf).filter((spec) => !OWN_CONFIG.test(spec.file));
  const inReport: Record<string, number> = {};
  for (const spec of specs) {
    const firsts = spec.tests
      .filter((test) => test.projectName === "chromium")
      .map((test) => test.results[0]?.duration ?? 0);
    inReport[spec.file] = (inReport[spec.file] ?? 0) + firsts.reduce((a, b) => a + b, 0) / 1000;
  }
  for (const [file, s] of Object.entries(inReport)) (samples[file] ??= []).push(s);
}
const seconds = Object.fromEntries(
  Object.entries(samples).map(([file, s]) => [file, s.reduce((a, b) => a + b, 0) / s.length]),
);

const sorted = Object.fromEntries(
  Object.entries({ ...previous, ...seconds })
    .filter(([file]) => existsSync(`tests/e2e/${file}`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, s]) => [file, Math.round(s * 10) / 10]),
);
await Bun.write(out, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${Object.keys(sorted).length} files written to ${out}`);
