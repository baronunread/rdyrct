import { defineProof, type Named, type Proof } from "@gdp-ts/core";
import { HTTPException } from "hono/http-exception";
import type { DB, SessionUser } from "../env";
import { orgRole } from "../org-role";

const CanDeleteOrg = defineProof("CanDeleteOrg");

export interface OrgDeletion<U, O> extends Proof<"CanDeleteOrg", [U, O]> {}

/** A request-local check, never a replacement for the route's state guards. */
export async function canDeleteOrg<U, O>(
  db: DB,
  user: Named<U, SessionUser>,
  org: Named<O, string>,
): Promise<OrgDeletion<U, O>> {
  if ((await orgRole(db, user.value, org.value)) !== "owner")
    throw new HTTPException(403, { message: "Insufficient role" });
  return CanDeleteOrg.prove(user, org);
}
