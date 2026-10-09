// Production deploy: only a released commit goes out (a v* tag on origin/main
// with green CI), schema first, then code. FORCE_DEPLOY=1 skips the guard for
// a hotfix. Migrations stay additive (no DROP/RENAME), so the old Worker keeps
// running against the new schema until the deploy lands.
import { $ } from "bun";

const out = async (cmd: ReturnType<typeof $>) => (await cmd.quiet().text()).trim();
const fail = (msg: string): never => {
  console.error(`deploy refused: ${msg} (FORCE_DEPLOY=1 to override)`);
  process.exit(1);
};

if (!process.env.FORCE_DEPLOY) {
  await $`git fetch --quiet origin main --tags`;
  const tag = await out($`git describe --exact-match --tags --match ${"v*"} HEAD`.nothrow());
  if (!tag) fail("HEAD is not a v* tag");
  if (await out($`git status --porcelain`)) fail("working tree is not clean");
  if ((await $`git merge-base --is-ancestor HEAD origin/main`.nothrow().quiet()).exitCode)
    fail(`${tag} is not on origin/main`);
  const sha = await out($`git rev-parse HEAD`);
  const ci = await out(
    $`gh run list --commit ${sha} --workflow test.yml --json conclusion --jq ${".[0].conclusion"}`,
  );
  if (ci !== "success") fail(`CI for ${tag} is "${ci || "missing"}", not success`);
  console.log(`deploying ${tag}`);
}

await $`wrangler d1 migrations apply DB --remote`;
await $`bun run build`;
await $`wrangler deploy`;
