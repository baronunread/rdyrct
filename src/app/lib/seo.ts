import { useEffect } from "react";
import { lookup } from "@/shared/lookup";
import { DEFAULT_PAGE_META, PUBLIC_PAGE_META } from "@/shared/page-meta";

// The Worker already writes each public page's head (src/worker/page-meta.ts). This is for
// client-side navigation, which keeps the head the visitor arrived with: a share from that
// tab would describe the wrong page.
function setAttribute(selector: string, attribute: string, value: string): void {
  document.head.querySelector(selector)?.setAttribute(attribute, value);
}

function pageTags(path: string, title: string, description: string) {
  const canonical = new URL(path, window.location.origin).toString();
  return [
    ['meta[name="description"]', "content", description],
    ['meta[property="og:title"]', "content", title],
    ['meta[property="og:description"]', "content", description],
    ['meta[property="og:url"]', "content", canonical],
    ['meta[name="twitter:title"]', "content", title],
    ['meta[name="twitter:description"]', "content", description],
    ['link[rel="canonical"]', "href", canonical],
  ] satisfies [string, string, string][];
}

export function useSeo(path: string) {
  useEffect(() => {
    const meta = lookup(PUBLIC_PAGE_META, path) ?? DEFAULT_PAGE_META;
    apply(path, meta);
    // Back to what index.html ships, not to what this document arrived carrying:
    // arrive on /privacy directly and the Worker has already written the privacy head,
    // so restoring that left the privacy title on the page they navigated to.
    return () => apply("/", DEFAULT_PAGE_META);
  }, [path]);
}

function apply(path: string, meta: { title: string; description: string }): void {
  document.title = meta.title;
  for (const [selector, attribute, value] of pageTags(path, meta.title, meta.description))
    setAttribute(selector, attribute, value);
}
