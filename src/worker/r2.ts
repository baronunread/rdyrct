import type { Env } from "./env";
import { qrLogoKeyFromUrl } from "./util";

/**
 * QR logo images live in the QR_LOGOS bucket; D1 rows store only the serving
 * URL (/api/orgs/<orgId>/qr-logo/<file>). Keys carry the org id so a whole
 * org's logos can be wiped by prefix on teardown.
 */

/** Delete one logo given its stored URL ('' and foreign URLs are no-ops). */
export async function deleteQrLogo(env: Env, url: string): Promise<void> {
  const key = qrLogoKeyFromUrl(url);
  if (!key) return;
  await env.QR_LOGOS.delete(key);
}

/** Delete every logo an org owns (the org default and all link overrides). */
export async function deleteOrgQrLogos(env: Env, orgId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.QR_LOGOS.list({ prefix: `${orgId}/`, cursor });
    await Promise.all(page.objects.map((o) => env.QR_LOGOS.delete(o.key)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
