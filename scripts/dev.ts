/**
 * `bun run dev`: the app, the Resend inbox and the Google sign-in emulator,
 * each behind portless under this checkout's names (scripts/dev-hosts.ts).
 *
 * It also does what a first run needs, so a fresh clone is `bun install`
 * then `bun run dev`: it creates `.dev.vars` from the example when there is
 * none, and applies the local D1 migrations.
 *
 * The Worker's addresses (APP_URL and the rest, DEV_HOST_KEYS) come from
 * here, not from `.dev.vars`: they depend on the checkout and on whether
 * portless runs in LAN mode, and a fixed value is wrong in every other
 * case. vite.config.ts passes them to the Worker when RDYRCT_DEV_HOSTS is
 * set.
 */
import { $, type Subprocess } from "bun";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { DEV_HOST_KEYS } from "./dev-host-keys";
import { devHostVars, devHosts } from "./dev-hosts";

const DEV_VARS = ".dev.vars";
const EXAMPLE = ".dev.vars.local.example";

if (!existsSync(DEV_VARS)) {
  // The example's values all work locally; only the auth secret is made up
  // here, so no two checkouts share one.
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  writeFileSync(
    DEV_VARS,
    readFileSync(EXAMPLE, "utf8").replace(
      /^BETTER_AUTH_SECRET=.*$/m,
      `BETTER_AUTH_SECRET=${secret}`,
    ),
  );
  console.log(`Created ${DEV_VARS} from ${EXAMPLE}.`);
}

// Lines that set one of the address keys: left over from before this script
// existed. They would override the right values, so stop rather than serve
// a checkout that cannot sign anybody in.
const pinned = readFileSync(DEV_VARS, "utf8")
  .split("\n")
  .filter((line) => DEV_HOST_KEYS.some((key) => line.trim().startsWith(`${key}=`)));
if (pinned.length) {
  console.error(
    `${DEV_VARS} sets this checkout's addresses, which bun run dev now works out itself.\n` +
      `Delete these lines from ${DEV_VARS}, then run it again:\n\n  ${pinned.join("\n  ")}\n`,
  );
  process.exit(1);
}

// The binding name, not the database's: `bun run setup` renames the
// database for a fork, and the binding stays `DB`.
await $`bunx wrangler d1 migrations apply DB --local`.quiet();

/**
 * The secret Polar's CLI signs the webhooks it forwards with (`bun run
 * polar:listen`), when `.dev.vars` sets none of its own. Nothing when the
 * CLI is missing, signed out or slow to answer (it gets three seconds): the
 * webhook route then refuses every event, which is right for a checkout
 * that cannot receive any.
 */
async function polarForwardSecret(devVars: string): Promise<string | undefined> {
  if (/^POLAR_WEBHOOK_SECRET=\S/m.test(devVars)) return undefined;
  try {
    const polar = Bun.spawn(["polar", "listen", "--print-secret"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    const [text, code] = await Promise.all([new Response(polar.stdout).text(), polar.exited]);
    return code === 0 ? text.trim() || undefined : undefined;
  } catch {
    // No `polar` on the PATH: spawn throws rather than exiting non-zero.
    return undefined;
  }
}
const polarSecret = await polarForwardSecret(readFileSync(DEV_VARS, "utf8"));

// The proxy first, on its own, in the foreground. On a fresh machine it asks
// for a password (port 443 needs sudo) and creates the CA the probe below
// reads; three `portless <name>` runs would otherwise race to start it, two
// of them with no terminal to ask on. When it already runs this is a no-op.
const proxy = Bun.spawnSync(["portless", "proxy", "start"], {
  stdio: ["inherit", "inherit", "inherit"],
});
if (!proxy.success) {
  console.error("portless could not start its proxy (see above). Fix that, then run this again.");
  process.exit(1);
}

const hosts = await devHosts();

const appEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...devHostVars(hosts),
  RDYRCT_DEV_HOSTS: "1",
};
if (polarSecret) appEnv.POLAR_WEBHOOK_SECRET = polarSecret;

/** The pinned devDependency, not whatever `bunx` would fetch today. */
const EMULATE = `${process.cwd()}/node_modules/.bin/emulate`;

/** One service behind portless. `$PORT` and `$PORTLESS_URL` come from
 * portless, so the shell expands them, not this script. */
const emulator = (name: string, args: string) =>
  [
    "portless",
    name,
    "sh",
    "-c",
    `exec "${EMULATE}" start ${args} --port "$PORT" --base-url "$PORTLESS_URL"`,
  ] as const;

const children: Subprocess[] = [];
const stop = (code: number) => {
  for (const child of children) child.kill();
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
// Whatever ends this process (an exception included) ends the servers too.
process.on("exit", () => {
  for (const child of children) child.kill();
});

try {
  children.push(
    Bun.spawn(["portless", hosts.name, "vite", "dev"], {
      env: appEnv,
      stdio: ["inherit", "inherit", "inherit"],
    }),
    Bun.spawn([...emulator(`${hosts.name}-mail`, "--service resend")], {
      stdio: ["ignore", "ignore", "inherit"],
    }),
    Bun.spawn(
      [...emulator(`${hosts.name}-google`, "--service google --seed google.emulate.yaml")],
      { stdio: ["ignore", "ignore", "inherit"] },
    ),
  );
  // One of them dying leaves a half-working app: take the rest down with it.
  for (const child of children) void child.exited.then((code) => stop(code ?? 1));

  // After vite's own start-up lines, so this is the last thing on screen.
  while (!(await ready(hosts.app))) await Bun.sleep(500);
} catch (error) {
  console.error(error);
  stop(1);
}

/**
 * Whether the app answers yet. portless's own CA signs its certificates, and
 * Bun trusts its bundled roots rather than the system's, so the probe names
 * the CA. It is read on every try: on a first run it may not exist yet.
 */
async function ready(app: string): Promise<boolean> {
  let ca: string | undefined;
  if (app.startsWith("https:")) {
    try {
      ca = readFileSync(`${homedir()}/.portless/ca.pem`, "utf8");
    } catch {
      return false;
    }
  }
  return fetch(`${app}/api/config`, ca ? { tls: { ca } } : {}).then(
    (res) => res.ok,
    () => false,
  );
}

/** This machine's LAN address, for the line about other devices. */
function lanAddress(): string | undefined {
  const nets = Object.values(networkInterfaces()).flatMap((n) => n ?? []);
  return nets.find((net) => net.family === "IPv4" && !net.internal)?.address;
}

const lan = new URL(hosts.app).hostname.endsWith(".local");
console.log(`
  rdyrct     ${hosts.app}
  scenarios  ${hosts.app}/__dev/scenarios
  inbox      ${hosts.mail}/emails  (header: authorization: Bearer test_token_admin)
  google     ${hosts.google}
${
  lan
    ? `\n  LAN mode: other devices on this network open the same URLs (this machine is ${lanAddress() ?? "on the LAN"}).\n`
    : `\n  Only this machine sees these. For other devices: sudo portless service install --lan\n`
}`);
