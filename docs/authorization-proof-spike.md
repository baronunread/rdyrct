# Organization deletion proof spike

The owner DELETE route and platform-admin DELETE route previously called
`deleteOrg(db, env, orgId)` after separate Hono guards. This pilot requires a
named authenticated actor, named organization ID and `OrgDeletion<U, O>` at
that service boundary. The organization is the resource being deleted.

`canDeleteOrg` checks the live role with `orgRole` before issuing evidence.
The owner route's existing lock/deletion state middleware and the admin
route's existing platform-admin middleware remain in place. The actor comes
from the authenticated request context, never a request body. Proofs are
request-local and erased as an authorization guarantee at runtime; the
runtime checks remain necessary.

The library is MIT licensed and experimental. This branch pins
[@gdp-ts/core source](https://github.com/rauchg/gdp-ts/tree/0b6ebeeec827b05210f3acfa4149a70dda9a0de5)
because published 0.1.0 predates the assertion-free forgery lint fixes. It
requires Oxlint 1.86+, so this branch updates Oxlint from 1.85 to 1.86.
The upstream TS lint entrypoint cannot run directly from node_modules under
Node's type stripping. `postinstall` builds that exact pinned source into a
node_modules cache file with Bun. Existing anti-slop rules remain enabled.

The pilot adds no-any, no-define-proof, no-proof-assertion and
no-null-assertion rules for Worker code and tests. The trusted proof module
also forbids all casts and exporting its prover. These are syntactic rules,
not a theorem prover or a security sandbox. Trusted check implementations,
authenticated actor provenance, ignored lint errors, JavaScript callers and
mutable values still need review. The system/account cleanup `deleteOrgs`
bulk helper remains a trusted raw-ID boundary outside this pilot.

## Evidence

- The worker-test TypeScript gate compiles a valid call and negative examples
  for absent evidence, raw IDs, wrong user and wrong organization/resource.
- Real Oxlint tests reject casts, definite-assignment and ambient proof
  declarations, null assertions, any, unchecked provers and exported provers.
- Cloudflare pool tests check owner/admin success and wrong-user/target denial.
  Disabling the live-role guard made the denial test fail; it was restored.
- Scoped teardown/account/admin tests and the full local verify gate pass.
- A browser scenario rejects another organization's DELETE with 403 and
  verifies the owner deletion, dialog closure and organization-less dashboard.

Five paired Worker typecheck trials on local macOS arm64 with Bun 1.4.2 and
the same installed dependencies: baseline total median 1.264 s
(1.251–4.023), pilot 1.260 s (1.086–2.879). Check-time medians were
1.043 s and 1.021 s. Timing spread is too large to infer a speed difference.
Median reported memory rose from 515,216 KB to 548,369 KB, about 6.4%.
This is a local pilot measurement, not a CI budget guarantee.

## Decision boundary

The cost is two closure-based call sites, one trusted proof module, extra
type/lint contracts, a Git dependency and a lint build step. The ordinary
owner path performs a second membership query after its middleware guard.
Platform admins still use `orgRole`'s existing admin shortcut.

Do not expand until review shows a useful reduction in authorization mistakes
and acceptable ergonomics. Stop if the additional query, compiler memory,
packaging workaround or trusted escape paths cost more than the protection
this one boundary provides. A later experiment could issue evidence from
middleware itself, but must preserve its runtime state checks.
