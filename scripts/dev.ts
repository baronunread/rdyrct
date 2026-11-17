/**
 * The Worker's addresses (DEV_HOST_KEYS) come from here, not `.dev.vars`: they depend on the checkout and on
 * whether portless runs in LAN mode. vite.config.ts passes them on when RDYRCT_DEV_HOSTS is set.
 */
import { $, type Subprocess } from "bun";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { DEV_HOST_KEYS } from "./dev-host-keys";
import { devHostVars, devHosts } from "./dev-hosts";

const DEV_VARS = ".dev.vars";
const EXAMPLE = ".dev.vars.local.example";

if (!existsSync(DEV_VARS)) {
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

// Left over from before this script: they would override the right values, so stop.
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
 * Nothing when the CLI is missing, signed out or slow (three seconds): the webhook route then refuses
 * every event, which is right for a checkout that cannot receive any.
 */
async function polarForwardSecret(): Promise<string | undefined> {
  if (!Bun.which("polar")) return undefined;
  const polar = Bun.spawn(["polar", "listen", "--print-secret"], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
  });
  const [text, code] = await Promise.all([new Response(polar.stdout).text(), polar.exited]);
  return code === 0 ? text.trim() || undefined : undefined;
}
const polarSecret = /^POLAR_WEBHOOK_SECRET=\S/m.test(readFileSync(DEV_VARS, "utf8"))
  ? undefined
  : await polarForwardSecret();

// The proxy first, alone, in the foreground: on a fresh machine it asks for a password (port 443 needs sudo),
// and three `portless <name>` runs would race to start it, two with no terminal to ask on.
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

const EMULATE = `${process.cwd()}/node_modules/.bin/emulate`;

/** `$PORT` and `$PORTLESS_URL` come from portless, so the shell expands them, not this script. */
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
  for (const child of children) void child.exited.then((code) => stop(code ?? 1));

  // After vite's own start-up lines, so this is the last thing on screen.
  while (!(await ready(hosts.app))) await Bun.sleep(500);
} catch (error) {
  console.error(error);
  stop(1);
}

/** portless's CA signs its certificates and Bun trusts only its bundled roots, so the probe names the CA.
 * Read on every try: on a first run it may not exist yet. */
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
