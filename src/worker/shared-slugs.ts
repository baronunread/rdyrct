import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { DB } from "./env";
import { randomSlug } from "./util";

/** Draws before giving up. A clash is about one in 27.5 billion per draw
 * while the pool is young, so five in a row should never happen. */
const ATTEMPTS = 5;

/**
 * Hands out a shared-domain slug nobody has ever had, and records it as
 * issued.
 *
 * An account's slug (any plan) is never reissued, even after its link is
 * deleted. The one exception is a link made without an account, which the
 * landing page sells as temporary: sweepExpiredAnonLinks frees its slug once
 * it expires unclaimed. Otherwise: an old post, email or
 * printed QR code still points at it, and whoever got it next could send
 * all of them anywhere. That is how dead bit.ly links in old brand tweets
 * came to show pages their owners never linked.
 *
 * The insert is the check: the primary key on `issued_slugs` refuses a slug
 * already there, so two requests drawing the same one at once cannot both
 * have it. `draw` is there for tests to force a clash.
 */
export async function allocateSharedSlug(db: DB, draw: () => string = randomSlug): Promise<string> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const slug = draw();
    const issued = await db
      .insert(schema.issuedSlugs)
      .values({ slug, issuedAt: Date.now() })
      .onConflictDoNothing()
      .returning({ slug: schema.issuedSlugs.slug });
    if (issued.length > 0) return slug;
  }
  throw new HTTPException(503, { message: "Could not allocate a link. Try again." });
}
