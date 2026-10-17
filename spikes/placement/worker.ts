interface Env {
  DB: D1Database;
  BENCH_KEY: string;
  VARIANT: string;
  LOOPBACK_ORIGIN: string;
}

async function query(env: Env) {
  const started = performance.now();
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const result = await env.DB.prepare("SELECT id, destination FROM links WHERE id = ?")
      .bind(i + 1)
      .all<{ id: number; destination: string }>();
    if (result.results.length !== 1)
      return Response.json({ error: "Fixture missing" }, { status: 503 });
    samples.push({ id: result.results[0].id, meta: result.meta });
  }
  return Response.json(
    { variant: env.VARIANT, elapsedMs: performance.now() - started, samples },
    { headers: { "cache-control": "no-store" } },
  );
}

async function loopback(env: Env): Promise<Response> {
  const target = new URL("/query", env.LOOPBACK_ORIGIN);
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: { authorization: `Bearer ${env.BENCH_KEY}` },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Loopback failed" },
      { status: 502 },
    );
  }
  if (response.status >= 300 && response.status < 400)
    return Response.json({ error: "Loopback redirect refused" }, { status: 502 });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-loopback-elapsed-ms": String(performance.now() - started),
      "x-inner-placement": response.headers.get("cf-placement") ?? "unreported",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/")
      return Response.json({
        experiment: "synthetic D1 placement",
        variant: env.VARIANT,
        queriesPerTrial: 10,
      });
    if (!env.BENCH_KEY || request.headers.get("authorization") !== `Bearer ${env.BENCH_KEY}`)
      return new Response(null, { status: 401 });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (url.pathname === "/direct" || url.pathname === "/query") return query(env);
    if (url.pathname === "/loopback") return loopback(env);
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
