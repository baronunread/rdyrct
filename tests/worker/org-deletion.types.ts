import type { Named } from "@gdp-ts/core";
import type { DB, Env, SessionUser } from "../../src/worker/env";
import type { OrgDeletion } from "../../src/worker/proofs/can-delete-org";
import { deleteOrg } from "../../src/worker/routes/orgs";

/** Compiled by the existing worker-test tsc gate; never executed. */
export function deletionTypeContracts<U, O, V, P>(
  db: DB,
  env: Env,
  actor: Named<U, SessionUser>,
  org: Named<O, string>,
  otherActor: Named<V, SessionUser>,
  otherOrg: Named<P, string>,
  proof: OrgDeletion<U, O>,
) {
  void deleteOrg(db, env, actor, org, proof);
  // @ts-expect-error The service requires evidence, even for the right target.
  void deleteOrg(db, env, actor, org);
  // @ts-expect-error Raw IDs are not named values or authorization evidence.
  void deleteOrg(db, env, actor.value, org.value, proof);
  // @ts-expect-error Evidence for one user cannot authorize another user.
  void deleteOrg(db, env, otherActor, org, proof);
  // @ts-expect-error The org is the resource: evidence cannot authorize another org.
  void deleteOrg(db, env, actor, otherOrg, proof);
}
