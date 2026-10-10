import * as v from "valibot";

const input = v.parse(
  v.object({ BENCH_KEY: v.string() }),
  await Bun.file(process.env.BENCH_SECRETS_FILE ?? "/private/tmp/placement-secrets.json").json(),
);
const schema = v.object({
  variant: v.string(),
  elapsedMs: v.number(),
  samples: v.array(
    v.object({
      id: v.number(),
      meta: v.object({
        duration: v.number(),
        served_by_region: v.optional(v.string()),
        served_by_colo: v.optional(v.string()),
        served_by_primary: v.optional(v.boolean()),
        total_attempts: v.optional(v.number()),
      }),
    }),
  ),
});
const origins = {
  default: "https://default-rdyrct-placement-spike.baronunreadts.workers.dev",
  smart: "https://smart-rdyrct-placement-spike.baronunreadts.workers.dev",
};
const records = [];
function failedTrial(
  trial: number,
  variant: string,
  path: string,
  started: number,
  error: string,
  status = 0,
  response?: Response,
) {
  return {
    trial,
    variant,
    path,
    status,
    error,
    clientMs: performance.now() - started,
    elapsedMs: null,
    samples: [],
    loopbackMs: null,
    placement: response?.headers.get("cf-placement") ?? null,
    innerPlacement: null,
    ray: response?.headers.get("cf-ray") ?? null,
  };
}
function parseResult(body: string) {
  try {
    return v.safeParse(schema, JSON.parse(body));
  } catch {
    return null;
  }
}
for (let trial = -3; trial < 30; trial++) {
  const variants = trial % 2 === 0 ? ["default", "smart"] : ["smart", "default"];
  for (const variant of variants)
    for (const path of trial % 2 === 0 ? ["direct", "loopback"] : ["loopback", "direct"]) {
      const origin = variant === "default" ? origins.default : origins.smart;
      const started = performance.now();
      const fetched = await fetch(`${origin}/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${input.BENCH_KEY}` },
        signal: AbortSignal.timeout(15_000),
      })
        .then(async (response) => ({ response, body: await response.text() }))
        .catch(() => null);
      if (!fetched) {
        records.push(failedTrial(trial, variant, path, started, "Transport failure or timeout"));
        continue;
      }
      const { response, body } = fetched;
      if (!response.ok) {
        records.push({
          trial,
          variant,
          path,
          status: response.status,
          error: response.status === 404 ? body : "Request failed",
          clientMs: performance.now() - started,
          elapsedMs: null,
          samples: [],
          loopbackMs: null,
          placement: response.headers.get("cf-placement"),
          innerPlacement: null,
          ray: response.headers.get("cf-ray"),
        });
        continue;
      }
      const parsed = parseResult(body);
      if (!parsed?.success) {
        records.push(
          failedTrial(trial, variant, path, started, "Invalid response JSON", 0, response),
        );
        continue;
      }
      const result = parsed.output;
      if (
        result.variant !== variant ||
        result.samples.length !== 10 ||
        result.samples.some((sample, i) => sample.id !== i + 1)
      ) {
        records.push(
          failedTrial(
            trial,
            variant,
            path,
            started,
            "Different query results or variant",
            0,
            response,
          ),
        );
        continue;
      }
      records.push({
        trial,
        path,
        status: response.status,
        error: null,
        clientMs: performance.now() - started,
        loopbackMs: response.headers.get("x-loopback-elapsed-ms"),
        placement: response.headers.get("cf-placement"),
        innerPlacement: response.headers.get("x-inner-placement"),
        ray: response.headers.get("cf-ray"),
        ...result,
      });
    }
  if (trial % 10 === 0) console.log(`Completed trial ${trial}`);
}
const summaries = [];
for (const variant of ["default", "smart"])
  for (const path of ["direct", "loopback"]) {
    const attempts = records.filter(
      (row) => row.trial >= 0 && row.variant === variant && row.path === path,
    );
    const group = attempts.filter((row) => row.status === 200);
    const summary = (values: number[]) => {
      const sorted = values.toSorted((a, b) => a - b);
      if (!sorted.length) return null;
      return {
        median:
          (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
        p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
        min: sorted[0],
        max: sorted.at(-1),
      };
    };
    summaries.push({
      variant,
      path,
      attempts: attempts.length,
      successes: group.length,
      failures: attempts.length - group.length,
      clientMs: summary(group.map((row) => row.clientMs)),
      queryMs: summary(group.map((row) => row.elapsedMs ?? 0)),
      loopbackMs: path === "loopback" ? summary(group.map((row) => Number(row.loopbackMs))) : null,
    });
  }
const output = {
  measuredAt: new Date().toISOString(),
  environment: {
    bun: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    concurrency: 1,
    warmups: 3,
    trials: 30,
    queriesPerTrial: 10,
    readReplication: false,
    d1LocationHint: "WEUR",
    origins,
  },
  summaries,
  records,
};
await Bun.write(new URL("results.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(summaries, null, 2));
if (summaries.some((summary) => summary.failures > 0)) process.exitCode = 1;
