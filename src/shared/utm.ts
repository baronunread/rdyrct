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

const UTM_PARAMS: ReadonlySet<string> = new Set(UTM_KEYS.map(([param]) => param));

/** A query's pairs exactly as written: split on `&`, nothing decoded. */
function rawPairs(search: string): string[] {
  return search.replace(/^\?/, "").split("&").filter(Boolean);
}

/** The decoded name of one raw `name=value` pair. */
function pairName(pair: string): string {
  const name = pair.split("=", 1)[0].replaceAll("+", " ");
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** `url` with its query replaced by `pairs`, joined as they are. Setting
 * `search` only escapes what a query may not hold, so every pair keeps its
 * own encoding: `a=b+c` stays `a=b+c`, where URLSearchParams would
 * rewrite the whole query in its own style. */
function withPairs(url: URL, pairs: string[]): string {
  url.search = pairs.length ? `?${pairs.join("&")}` : "";
  return url.toString();
}

/**
 * Strip utm_* params out of a destination, leaving every other query param
 * exactly as written. Called right after resolveUtm has already pulled any of
 * them into the UTM columns, so nothing is lost: `destination` stays the bare
 * link, buildDestination re-applies the stored columns at redirect time. An
 * imported link (#383) has to land where it did on the old service, so the
 * other params are not even re-encoded.
 */
export function stripUtmParams(destination: string): string {
  try {
    const url = new URL(destination);
    return withPairs(
      url,
      rawPairs(url.search).filter((pair) => !UTM_PARAMS.has(pairName(pair))),
    );
  } catch {
    return destination;
  }
}

/** Destination with the link's UTM params appended (existing params win, and
 * keep their own encoding). */
export function buildDestination(destination: string, utm: UtmFields): string {
  try {
    const url = new URL(destination);
    const pairs = rawPairs(url.search);
    const present = new Set(pairs.map(pairName));
    for (const [param, field] of UTM_KEYS) {
      const value = utm[field];
      // Encoded the way URLSearchParams always did here (a space is `+`), so
      // a link's redirect does not change because this moved to raw pairs.
      if (value && !present.has(param))
        pairs.push(new URLSearchParams({ [param]: value }).toString());
    }
    return withPairs(url, pairs);
  } catch {
    return destination;
  }
}
