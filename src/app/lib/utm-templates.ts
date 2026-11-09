/**
 * Saved UTM templates for the free builder: a set of tags somebody reuses
 * (the weekly newsletter, the launch on LinkedIn), kept in this browser.
 *
 * localStorage, not an account: the page needs none, and a template holds
 * nothing but the five tag values. Junk under the key is dropped on read
 * rather than repaired.
 */
import { useMemo, useSyncExternalStore } from "react";
import * as v from "valibot";
import { UTM_KEYS } from "@/shared/utm";
import type { UtmFields } from "@/shared/utm";

const KEY = "rdyrct:utm-templates:v1";
const CHANGED = "rdyrct:utm-templates";

/** More than this and the row of templates is a list nobody scans. */
const MAX_UTM_TEMPLATES = 12;

const fieldsSchema = v.object({
  utmSource: v.string(),
  utmMedium: v.string(),
  utmCampaign: v.string(),
  utmTerm: v.string(),
  utmContent: v.string(),
});

const storedSchema = v.pipe(
  v.array(v.unknown()),
  v.transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = v.safeParse(fieldsSchema, entry);
      return parsed.success ? [parsed.output] : [];
    }),
  ),
);

/** The name a template goes by: its values in the order they are read, an
 *  empty one in the middle as "–" so that each value keeps its place and two
 *  different templates never read the same ("a / – / b" is not "a / b").
 *  Empty values at the end are left off. */
export function templateName(fields: UtmFields): string {
  const values = [
    fields.utmSource,
    fields.utmMedium,
    fields.utmCampaign,
    fields.utmContent,
    fields.utmTerm,
  ];
  while (values.length && !values.at(-1)) values.pop();
  return values.map((value) => value || "–").join(" / ");
}

/** A key that differs whenever the tags do, for lists. */
export const templateKey = (fields: UtmFields) => UTM_KEYS.map(([, key]) => fields[key]).join("\n");

/** The values as the link uses them, with no edge spaces. */
export const trimTags = (fields: UtmFields): UtmFields => ({
  utmSource: fields.utmSource.trim(),
  utmMedium: fields.utmMedium.trim(),
  utmCampaign: fields.utmCampaign.trim(),
  utmTerm: fields.utmTerm.trim(),
  utmContent: fields.utmContent.trim(),
});

export const sameTags = (a: UtmFields, b: UtmFields) =>
  UTM_KEYS.every(([, key]) => a[key] === b[key]);

function read(raw: string | null): UtmFields[] {
  if (!raw) return [];
  try {
    const parsed = v.safeParse(storedSchema, JSON.parse(raw));
    return parsed.success ? parsed.output.slice(0, MAX_UTM_TEMPLATES) : [];
  } catch {
    return [];
  }
}

function snapshot(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(templates: UtmFields[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates.slice(0, MAX_UTM_TEMPLATES)));
  } catch {
    // Private mode, or storage disabled: the template lasts as long as the tab.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Saves the tags at the front, once: saving the same tags again moves them
 *  to the front instead of adding a twin. Values are trimmed, as the link
 *  trims them. */
export function saveTemplate(fields: UtmFields): void {
  const trimmed = trimTags(fields);
  write([trimmed, ...read(snapshot()).filter((t) => !sameTags(t, trimmed))]);
}

export function removeTemplate(fields: UtmFields): void {
  write(read(snapshot()).filter((t) => !sameTags(t, fields)));
}

/** The saved templates, newest first. Empty in the prerendered page, where
 *  there is no storage, so the row appears after hydration. */
export function useUtmTemplates(): UtmFields[] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => read(raw), [raw]);
}
