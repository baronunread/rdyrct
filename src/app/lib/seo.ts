import { useEffect } from "react";
import { PUBLIC_PAGE_META } from "@/shared/page-meta";

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
/** Sets one attribute and hands back the undo, so leaving a page restores
 * whatever the document arrived with. */
function setAttribute(selector: string, attribute: string, value: string): () => void {
  const element = document.head.querySelector(selector);
  if (!element) return () => {};
  const before = element.getAttribute(attribute) ?? "";
  element.setAttribute(attribute, value);
  return () => element.setAttribute(attribute, before);
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
    const meta = PUBLIC_PAGE_META[path];
    if (!meta) return;

    const previousTitle = document.title;
    document.title = meta.title;
    const undo = pageTags(path, meta.title, meta.description).map(([selector, attribute, value]) =>
      setAttribute(selector, attribute, value),
    );

    return () => {
      document.title = previousTitle;
      for (const restore of undo) restore();
    };
  }, [path]);
}
