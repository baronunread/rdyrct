/**
 * UTM tagging, shared because two sides build the same URL: the Worker, which
 * stores a link's UTM columns and applies them on redirect, and the free UTM
 * builder at /utm-builder, which tags a URL in the browser with no account.
 * Both have to produce the address the redirect would send.
 */

export const UTM_KEYS = [
  ["utm_source", "utmSource"],
  ["utm_medium", "utmMedium"],
  ["utm_campaign", "utmCampaign"],
  ["utm_term", "utmTerm"],
  ["utm_content", "utmContent"],
] as const;

export interface UtmFields {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
}

export const EMPTY_UTM: UtmFields = {
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
};

/**
 * Resolve the UTM fields to store on a link. Params already present in the
 * destination URL win (they are what the redirect sends), then explicit
 * fields (an empty string clears), then the base (existing values on update).
 * Keeps the stored columns in sync with what buildDestination emits.
 */
export function resolveUtm(
  destination: string,
  fields: Partial<UtmFields>,
  base: UtmFields = EMPTY_UTM,
): UtmFields {
  let url: URL | null = null;
  try {
    url = new URL(destination);
  } catch {
    // invalid destination: fields and base decide
  }
  const out = { ...base };
  for (const [param, field] of UTM_KEYS) {
    const fromUrl = url?.searchParams.get(param)?.trim();
    if (fromUrl) {
      out[field] = fromUrl;
      continue;
    }
    const fromField = fields[field];
    if (fromField !== undefined) {
      out[field] = fromField.trim();
      continue;
    }
    out[field] = base[field];
  }
  return out;
}

/**
 * Strip utm_* params out of a destination, leaving every other query param
 * alone. Called right after resolveUtm has already pulled any of them into
 * the UTM columns, so nothing is lost: `destination` stays the bare link,
 * buildDestination re-applies the stored columns at redirect time.
 */
export function stripUtmParams(destination: string): string {
  try {
    const url = new URL(destination);
    for (const [param] of UTM_KEYS) url.searchParams.delete(param);
    return url.toString();
  } catch {
    return destination;
  }
}

/** Destination with the link's UTM params applied (existing params win). */
export function buildDestination(destination: string, utm: UtmFields): string {
  try {
    const url = new URL(destination);
    for (const [param, field] of UTM_KEYS) {
      const value = utm[field];
      if (value && !url.searchParams.has(param)) url.searchParams.set(param, value);
    }
    return url.toString();
  } catch {
    return destination;
  }
}
