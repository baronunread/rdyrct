import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { DB } from "./env";
import { randomSlug } from "./util";

const ATTEMPTS = 5;

// Never reissued, even after the link is deleted: old posts and printed QR
// codes still point at it. Only anonymous links are freed (sweepExpiredAnonLinks).
// The primary key on issued_slugs is the check, so concurrent draws cannot clash.
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
