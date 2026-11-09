/**
 * The state of the UTM builder's "Many links" mode, apart from its
 * components (components/utm-bulk.tsx) so that file exports components only.
 */
import { useState } from "react";
import type { UtmFields } from "@/shared/utm";
import {
  MAX_BULK_LINKS,
  bulkLinks,
  channelKey,
  channelOptions,
  typedChannelNote,
  type BulkResult,
  type UtmChannel,
} from "./utm-tools";

/** The addresses, the picked channels and the refusal mark; the tags
 *  themselves are the page's, shared with the one-link builder so switching
 *  keeps them. */
export function useBulkLinks(fields: UtmFields, templates: readonly UtmFields[]) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [refused, setRefused] = useState(0);
  const channels = channelOptions(templates);
  const chosen = channels.filter((channel) => picked.has(channelKey(channel)));
  return {
    text,
    channels,
    picked,
    refused,
    result: bulkLinks(text, chosen, fields),
    typedNote: typedChannelNote(chosen, fields),
    /** Why there is nothing to copy: no text yet, or no line that is a web
     *  address, as the one-link field says. */
    refusal: text.trim() ? "Not a web address" : "Paste a link first",
    changeText: (value: string) => {
      setText(value);
      setRefused(0);
    },
    toggle: (channel: UtmChannel) => {
      const key = channelKey(channel);
      setPicked((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    },
    /** Copy or Download with no link to act on marks the address field. */
    refuse: () => setRefused((n) => n + 1),
    /** Leaving the mode answers the mark, so coming back neither focuses the
     *  field nor shakes it again. */
    clearRefusal: () => setRefused(0),
  };
}

export type BulkLinksState = ReturnType<typeof useBulkLinks>;

/** What the builder left out or replaced, said once: lines that are not
 *  addresses, lines whose tags the fields replace, and links past the cap.
 *  Null when there is nothing to say. */
export function bulkNote({ badLines, taggedLines, capped }: BulkResult): string | null {
  const notes = [
    linesNote(
      badLines,
      "is not a web address, so it was left out",
      "are not web addresses, so they were left out",
    ),
    linesNote(
      taggedLines,
      "already had UTM tags; the fields replace them",
      "already had UTM tags; the fields replace them",
    ),
    capped ? `Only the first ${MAX_BULK_LINKS} links are built at once.` : "",
  ].filter(Boolean);
  return notes.length ? notes.join(" ") : null;
}

/** "Line 3 is …" or "Lines 3, 7 are …", naming at most five lines. */
function linesNote(lines: readonly number[], one: string, many: string): string {
  if (!lines.length) return "";
  if (lines.length === 1) return `Line ${lines[0]} ${one}.`;
  const more = lines.length > 5 ? ` and ${lines.length - 5} more` : "";
  return `Lines ${lines.slice(0, 5).join(", ")}${more} ${many}.`;
}
