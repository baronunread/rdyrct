/**
 * Refreshes tests/e2e/shard-times.json, the per-file durations the CI shards
 * are balanced on (tests/e2e/shards.ts), from Playwright JSON reports.
 *
 *   bun run e2e:shard-times report.json [more.json ...]
 *
 * Pass every shard's report from one CI run (the e2e job uploads them as the
 * `e2e-timings-*` artifacts), or one report from a full local run. Only the
 * chromium project counts, and only the first attempt of each test, so a
 * retry does not make a file look slower than it is.
 */
type Suite = {
  file?: string;
  suites?: Suite[];
  specs?: { file: string; tests: { projectName: string; results: { duration: number }[] }[] }[];
};
type Report = { suites: Suite[] };

const out = "tests/e2e/shard-times.json";
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

const seconds: Record<string, number> = {};
for (const path of reports) {
  const report: Report = await Bun.file(path).json();
  // Top-level files only: production/ and self-host/ have configs of their own.
  const specs = report.suites.flatMap(specsOf).filter((spec) => !spec.file.includes("/"));
  for (const spec of specs) {
    const firsts = spec.tests
      .filter((test) => test.projectName === "chromium")
      .map((test) => test.results[0]?.duration ?? 0);
    seconds[spec.file] = (seconds[spec.file] ?? 0) + firsts.reduce((a, b) => a + b, 0) / 1000;
  }
}

const sorted = Object.fromEntries(
  Object.entries(seconds)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, s]) => [file, Math.round(s * 10) / 10]),
);
await Bun.write(out, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${Object.keys(sorted).length} files written to ${out}`);
