import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { requireOrgRole, orgRole } from "../auth";
import { orgPlan } from "../plan";
import { uid, qrLogoUrl, QR_LOGO_FILE_RE } from "../util";
import { QR_LOGO_MAX_BYTES } from "@/shared/types";

// Mounted at /api/orgs/:orgId/qr-logo. Both upload and serving are gated to
// org members: a logo is only ever fetched by the signed-in app (QR previews
// and downloads bake the image in client-side, nothing fetches it later).
export const qrLogoRoutes = new Hono<AppEnv>();

const EXT_BY_TYPE: Record<string, string> = {
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function isWebp(body: ArrayBuffer) {
  const bytes = new Uint8Array(body);
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

function isSvg(body: ArrayBuffer) {
  const text = new TextDecoder().decode(body);
  return /^\s*(?:<\?xml[^>]*\?>\s*)?<svg(?:\s|>)/i.test(text);
}

qrLogoRoutes.post("/", requireOrgRole("member"), async (c) => {
  // A logo is QR customization: a paid feature.
  const { limits } = await orgPlan(c.var.db, c.req.param("orgId")!);
  if (!limits.qr)
    throw new HTTPException(402, {
      message: "QR customization is a paid feature: upgrade to use it",
    });

  const type = c.req.header("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const ext = EXT_BY_TYPE[type];
  if (!ext)
    throw new HTTPException(400, {
      message: "Logo must be a compressed WebP or SVG image",
    });

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) throw new HTTPException(400, { message: "Empty file" });
  if ((type === "image/webp" && !isWebp(body)) || (type === "image/svg+xml" && !isSvg(body)))
    throw new HTTPException(400, { message: "Logo file does not match its format" });
  if (body.byteLength > QR_LOGO_MAX_BYTES)
    throw new HTTPException(400, { message: "Logo too large (max 256 KB)" });

  const file = `${uid()}.${ext}`;
  const orgId = c.req.param("orgId")!;
  await c.env.QR_LOGOS.put(`${orgId}/${file}`, body, {
    httpMetadata: { contentType: type },
  });
  return c.json({ url: qrLogoUrl(orgId, file) }, 201);
});

// Logo objects are immutable (a new upload gets a new key), so the browser
// may cache them forever; `private` keeps them out of shared caches. The CSP
// header keeps an SVG logo from running scripts if the URL is opened directly.
// Unauthorized access always returns 404 so the URL leaks nothing.
qrLogoRoutes.get("/:file", async (c) => {
  const file = c.req.param("file");
  if (!QR_LOGO_FILE_RE.test(file)) throw new HTTPException(404, { message: "Not found" });

  const user = c.var.user;
  if (!user) throw new HTTPException(404, { message: "Not found" });
  const orgId = c.req.param("orgId")!;
  const role = await orgRole(c.var.db, user, orgId);
  if (!role) throw new HTTPException(404, { message: "Not found" });

  const obj = await c.env.QR_LOGOS.get(`${orgId}/${file}`);
  if (!obj) throw new HTTPException(404, { message: "Not found" });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "content-security-policy",
    "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
  );
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
});
