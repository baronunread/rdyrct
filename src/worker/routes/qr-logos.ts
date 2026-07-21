import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { requireOrgRole } from "../auth";
import { orgPlan } from "../plan";
import { uid, qrLogoUrl } from "../util";
import { QR_LOGO_MAX_BYTES } from "@/shared/types";

// Mounted at /api/orgs/:orgId/qr-logo. Both upload and serving are gated to
// org members: a logo is only ever fetched by the signed-in app (QR previews
// and downloads bake the image in client-side, nothing fetches it later).
export const qrLogoRoutes = new Hono<AppEnv>();

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

qrLogoRoutes.post("/", requireOrgRole("member"), async (c) => {
  // A logo is QR customization: a paid feature.
  const { limits } = await orgPlan(c.var.db, c.req.param("orgId")!);
  if (!limits.qr)
    throw new HTTPException(402, {
      message: "QR customization is a paid feature: upgrade to use it",
    });

  const type =
    c.req.header("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const ext = EXT_BY_TYPE[type];
  if (!ext)
    throw new HTTPException(400, {
      message: "Logo must be a PNG, JPEG, GIF, WebP, AVIF, or SVG image",
    });

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) throw new HTTPException(400, { message: "Empty file" });
  if (body.byteLength > QR_LOGO_MAX_BYTES)
    throw new HTTPException(400, { message: "Logo too large (max 2 MB)" });

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
qrLogoRoutes.get("/:file", requireOrgRole("member"), async (c) => {
  const file = c.req.param("file");
  if (!/^[A-Za-z0-9]+\.[a-z0-9]+$/.test(file))
    throw new HTTPException(404, { message: "Not found" });
  const obj = await c.env.QR_LOGOS.get(`${c.req.param("orgId")!}/${file}`);
  if (!obj) throw new HTTPException(404, { message: "Not found" });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "script-src 'none'");
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
});
