/**
 * Search results cut a title near 70 characters and a description near 160,
 * and site audits (Ahrefs, 2026-11) flag every page past either. Each public
 * page writes its own pair in page-meta.ts, so a long one is easy to add and
 * nothing else would notice.
 */
import { expect, test } from "bun:test";
import { DEFAULT_PAGE_META, PUBLIC_PAGE_META } from "../src/shared/page-meta";

const pages = Object.entries({ "(default)": DEFAULT_PAGE_META, ...PUBLIC_PAGE_META });

test.each(pages)("%s has a title of 70 characters or fewer", (_path, meta) => {
  expect(meta.title.length).toBeLessThanOrEqual(70);
});

test.each(pages)("%s has a description of 160 characters or fewer", (_path, meta) => {
  expect(meta.description.length).toBeLessThanOrEqual(160);
});
