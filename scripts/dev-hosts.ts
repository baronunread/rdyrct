/**
 * Each name is one DNS label (`rdyrct-mail`, never `mail.rdyrct`): in LAN mode they become `.local` names,
 * and Windows only finds single-label ones. portless picks the TLD, so URLs come from `portless get`.
 */
import { $ } from "bun";
import { DEV_HOST_KEYS } from "./dev-host-keys";

export function label(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

export async function devName(): Promise<string> {
  const [gitDir, commonDir] = (await $`git rev-parse --absolute-git-dir --git-common-dir`.text())
    .trim()
    .split("\n");
  const common = (await $`realpath ${commonDir}`.text()).trim();
  if (gitDir === common) return "rdyrct";
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
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
