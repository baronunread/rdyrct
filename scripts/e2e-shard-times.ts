/**
 * Refreshes tests/e2e/shard-times.json from Playwright JSON reports: `bun run e2e:shard-times report.json ...`.
 * Only chromium counts, and only each test's first attempt, so a retry does not make a file look slower.
 * A local run needs `--reporter=json`.
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

// Merged into the table already there: a partial report keeps the rest, and files that no longer exist drop out.
const previous: Record<string, number> = await Bun.file(out).json();
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
