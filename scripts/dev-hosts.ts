/**
 * The local dev addresses of this checkout: the app, the Resend inbox and the
 * Google sign-in emulator, each a portless name.
 *
 * One name per checkout, so two checkouts (the main one and a worktree) can
 * run side by side: `rdyrct` in the main checkout, `rdyrct-<branch>` in a git
 * worktree. Each name is a single DNS label (`rdyrct-mail`, never
 * `mail.rdyrct`): in portless's LAN mode they become `.local` names, and
 * Windows only finds single-label `.local` names on the network.
 *
 * portless decides the TLD (`.localhost`, or `.local` in LAN mode), so the
 * URLs come from `portless get` rather than being spelled out here.
 *
 * Run it to print them: `bun scripts/dev-hosts.ts` (or `... app` for one).
 */
import { $ } from "bun";
import { DEV_HOST_KEYS } from "./dev-host-keys";

/** A git branch as one DNS label: lowercase letters, digits and hyphens. */
export function label(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** `rdyrct` in the main checkout, `rdyrct-<branch>` in a linked worktree. */
export async function devName(): Promise<string> {
  const [gitDir, commonDir] = (await $`git rev-parse --absolute-git-dir --git-common-dir`.text())
    .trim()
    .split("\n");
  const common = (await $`realpath ${commonDir}`.text()).trim();
  if (gitDir === common) return "rdyrct";
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
  // A detached worktree has no branch; its directory name stands in.
  const id = branch === "HEAD" ? (await $`basename ${process.cwd()}`.text()).trim() : branch;
  return `rdyrct-${label(id)}`;
}

export interface DevHosts {
  name: string;
  app: string;
  mail: string;
  google: string;
}

// --no-worktree: the name already says which checkout it is, and
// `portless <name> <cmd>` (how dev.ts starts each one) adds no prefix either.
const urlOf = async (name: string) => (await $`portless get ${name} --no-worktree`.text()).trim();

export async function devHosts(): Promise<DevHosts> {
  const name = await devName();
  const [app, mail, google] = await Promise.all([
    urlOf(name),
    urlOf(`${name}-mail`),
    urlOf(`${name}-google`),
  ]);
  return { name, app, mail, google };
}

export function devHostVars(hosts: DevHosts) {
  const host = new URL(hosts.app).host;
  return {
    APP_URL: hosts.app,
    APP_HOST: host,
    SHARED_LINK_HOST: host,
    RESEND_BASE_URL: hosts.mail,
    GOOGLE_EMULATOR_URL: hosts.google,
  } satisfies Record<(typeof DEV_HOST_KEYS)[number], string>;
}

if (import.meta.main) {
  const hosts = await devHosts();
  const which = process.argv[2];
  if (which === "app" || which === "mail" || which === "google") console.log(hosts[which]);
  else console.log(`app     ${hosts.app}\nmail    ${hosts.mail}\ngoogle  ${hosts.google}`);
}
