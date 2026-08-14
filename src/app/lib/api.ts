import * as v from "valibot";
import type { JsonValue } from "@/shared/types";

export class ApiError extends Error {
  status: number;
  /** machine-readable code from the error body, e.g. "slug_taken" */
  code?: string;
  /** The full parsed error body, for a code that carries extra fields beyond
   * message/code (e.g. "same_destination_match"'s matchedLinkId/matchedLink). */
  data?: unknown;
  constructor(status: number, message: string, code?: string, data?: JsonValue) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** The two fields the app reads off an error body; the rest rides along on
 * ApiError.data for the caller that knows to look for it. */
const errorBodySchema = v.object({
  message: v.optional(v.fallback(v.string(), ""), ""),
  code: v.optional(v.fallback(v.string(), ""), ""),
});

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = res.statusText;
  let code: string | undefined;
  let data: JsonValue | undefined;
  try {
    data = await res.json();
    const body = v.parse(errorBodySchema, data ?? {});
    if (body.message) message = body.message;
    code = body.code || undefined;
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(res.status, message, code, data);
}

export async function api<T>(
  path: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  await throwIfNotOk(res);
  return res.json() as Promise<T>;
}

/**
 * Upload a QR logo image to R2; returns the serving URL to store on the org
 * or link row. Raw body, not JSON, so this doesn't go through api().
 */
export async function uploadQrLogo(orgId: string, file: File): Promise<string> {
  const res = await fetch(`/api/orgs/${orgId}/qr-logo`, {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  await throwIfNotOk(res);
  return ((await res.json()) as { url: string }).url;
}

export const shortUrl = (slug: string, domain?: string | null) =>
  domain ? `https://${domain}/${slug}` : `${window.location.origin}/${slug}`;
