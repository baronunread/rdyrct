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

await $`bunx wrangler d1 migrations apply rdyrct --local`.quiet();

/**
 * The secret Polar's CLI signs the webhooks it forwards with (`bun run
 * polar:listen`), when `.dev.vars` sets none of its own. Nothing when the
 * CLI is missing or signed out: the webhook route then refuses every event,
 * which is right for a checkout that cannot receive any.
 */
async function polarForwardSecret(devVars: string): Promise<string | undefined> {
  if (/^POLAR_WEBHOOK_SECRET=\S/m.test(devVars)) return undefined;
  try {
    const out = await $`polar listen --print-secret`.nothrow().quiet();
    return out.exitCode === 0 ? out.text().trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}
const polarSecret = await polarForwardSecret(readFileSync(DEV_VARS, "utf8"));

const hosts = await devHosts();

const appEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...devHostVars(hosts),
  RDYRCT_DEV_HOSTS: "1",
};
if (polarSecret) appEnv.POLAR_WEBHOOK_SECRET = polarSecret;

/** One service behind portless. `$PORT` and `$PORTLESS_URL` come from
 * portless, so the shell expands them, not this script. */
const emulator = (name: string, args: string) =>
  [
    "portless",
    name,
    "sh",
    "-c",
    `exec bunx emulate start ${args} --port "$PORT" --base-url "$PORTLESS_URL"`,
  ] as const;

const children: Subprocess[] = [
  Bun.spawn(["portless", hosts.name, "vite", "dev"], {
    env: appEnv,
    stdio: ["inherit", "inherit", "inherit"],
  }),
  Bun.spawn([...emulator(`${hosts.name}-mail`, "--service resend")], {
    stdio: ["ignore", "ignore", "inherit"],
  }),
  Bun.spawn([...emulator(`${hosts.name}-google`, "--service google --seed google.emulate.yaml")], {
    stdio: ["ignore", "ignore", "inherit"],
  }),
];

const stop = (code: number) => {
  for (const child of children) child.kill();
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
// One of them dying leaves a half-working app: take the rest down with it.
for (const child of children) void child.exited.then((code) => stop(code ?? 1));

/** This machine's LAN address, for the line about other devices. */
function lanAddress(): string | undefined {
  const nets = Object.values(networkInterfaces()).flatMap((n) => n ?? []);
  return nets.find((net) => net.family === "IPv4" && !net.internal)?.address;
}

// After vite's own start-up lines, so this is the last thing on screen.
// portless's own CA signs these, and Bun trusts its bundled roots rather
// than the system's, so the probe names the CA.
const ca = readFileSync(`${homedir()}/.portless/ca.pem`, "utf8");
const ready = () =>
  fetch(`${hosts.app}/api/config`, { tls: { ca } }).then(
    (res) => res.ok,
    () => false,
  );
while (!(await ready())) await Bun.sleep(500);

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
