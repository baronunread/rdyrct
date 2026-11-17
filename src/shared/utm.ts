/** Shared: the Worker and the free /utm-builder must produce the same address the redirect sends. */

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

/** Params already in the destination win (the redirect sends them), then explicit fields (an empty string clears), then the base. */
export function resolveUtm(
  destination: string,
  fields: Partial<UtmFields>,
  base: UtmFields = EMPTY_UTM,
): UtmFields {
  let url: URL | null = null;
  try {
    url = new URL(destination);
  } catch {}
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

function rawPairs(search: string): string[] {
  return search.replace(/^\?/, "").split("&").filter(Boolean);
}

function pairName(pair: string): string {
  const name = pair.split("=", 1)[0].replaceAll("+", " ");
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Setting `search` escapes only what a query may not hold, so each pair keeps its own encoding:
 * `a=b+c` stays `a=b+c`, where URLSearchParams would rewrite the whole query. */
function withPairs(url: URL, pairs: string[]): string {
  url.search = pairs.length ? `?${pairs.join("&")}` : "";
  return url.toString();
}

/** Called after resolveUtm moved utm_* into the UTM columns; buildDestination re-applies them at
 * redirect time. Other params stay unencoded so an imported link (#383) lands where it did before. */
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
