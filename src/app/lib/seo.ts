import { useEffect } from "react";
import { lookup } from "@/shared/lookup";
import { DEFAULT_PAGE_META, PUBLIC_PAGE_META } from "@/shared/page-meta";

/**
 * Keeps the head honest after a client-side navigation.
 *
 * The Worker already writes each public page's title, description and
 * canonical into the HTML it serves (src/worker/page-meta.ts), which is what
 * a crawler or a link preview reads. This is for the case that has no new
 * document at all: somebody on the landing page clicking through to the QR
 * generator keeps the head they arrived with, so a share from that tab would
 * describe the wrong page.
 *
 * Both read the same strings, so the two cannot drift.
 */
/** Sets one attribute, if the document has that tag at all. */
function setAttribute(selector: string, attribute: string, value: string): void {
  document.head.querySelector(selector)?.setAttribute(attribute, value);
}

/** Every tag a page owns, with the value it should carry. */
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
    // Back to what index.html ships, not to what this document arrived
    // carrying. Those are the same thing only for somebody who walked here
    // from elsewhere in the app: arrive on /privacy directly and the Worker
    // has already written the privacy head into the document, so restoring
    // "what we arrived with" left the privacy title sitting on the dashboard
    // they navigated to.
    return () => apply("/", DEFAULT_PAGE_META);
  }, [path]);
}

function apply(path: string, meta: { title: string; description: string }): void {
  document.title = meta.title;
  for (const [selector, attribute, value] of pageTags(path, meta.title, meta.description))
    setAttribute(selector, attribute, value);
}
