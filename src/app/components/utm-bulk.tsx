/**
 * The UTM builder's "Many links" mode: one tagged link for every address
 * and channel, to copy at once or download as a spreadsheet.
 *
 * The two jobs it covers are the ones a single builder makes tedious: one
 * page posted to several channels (one address, several channels) and one
 * campaign across many pages (many addresses, one channel). Built in the
 * browser like the single link, and never shortened: the anonymous
 * shortener makes one link per browser.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download } from "@/app/ui/icons";
import type { UtmFields } from "@/shared/utm";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { cn } from "../ui/cn";
import { Field, Textarea } from "../ui/field";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { downloadCsv } from "../lib/csv";
import { trackCta } from "../lib/track-cta";
import {
  MAX_BULK_LINKS,
  bulkCsv,
  bulkFilename,
  bulkLinks,
  channelKey,
  channelOptions,
  typedChannelNote,
  type BulkResult,
  type UtmChannel,
} from "../lib/utm-tools";
import { TaggedText } from "./utm-tagged-text";

/** The state of the many-links builder; the tags themselves are the page's,
 *  shared with the one-link builder so switching keeps them. */
export function useBulkLinks(fields: UtmFields, templates: readonly UtmFields[]) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [refused, setRefused] = useState(0);
  const channels = channelOptions(templates);
  const chosen = channels.filter((channel) => picked.includes(channelKey(channel)));
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
      setPicked((current) =>
        current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
      );
    },
    /** Copy or Download with no link to act on marks the address field. */
    refuse: () => setRefused((n) => n + 1),
    /** Leaving the mode answers the mark, so coming back neither focuses the
     *  field nor shakes it again. */
    clearRefusal: () => setRefused(0),
  };
}

type Bulk = ReturnType<typeof useBulkLinks>;

/** The addresses, one per line, and the channels to tag them for. */
export function BulkInputs({ bulk }: { bulk: Bulk }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (bulk.refused) input.current?.focus();
  }, [bulk.refused]);
  const count = bulk.result.links.length;
  return (
    <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
      <Field
        label="Website URLs"
        error={bulk.refused && !count ? bulk.refusal : undefined}
        aside={<span className="tnum">One per line</span>}
      >
        <div key={bulk.refused} className={cn(bulk.refused > 0 && "motion-safe:animate-shake")}>
          <Textarea
            ref={input}
            rows={4}
            inputMode="url"
            value={bulk.text}
            onChange={(e) => bulk.changeText(e.target.value)}
            placeholder={"https://example.com/spring-sale\nhttps://example.com/pricing"}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
      </Field>
      <Channels bulk={bulk} />
    </div>
  );
}

/** The channels as pressed buttons, any number at once: each one picked is
 *  one more link per address. */
function Channels({ bulk }: { bulk: Bulk }) {
  return (
    <div className="min-w-0">
      <span className="mb-1.5 flex min-h-4 items-center text-xs text-muted">
        Channels: one link each
      </span>
      <div role="group" aria-label="Channels" className="flex flex-wrap gap-1.5">
        {bulk.channels.map((channel) => {
          const on = bulk.picked.includes(channelKey(channel));
          return (
            <button
              key={channelKey(channel)}
              type="button"
              aria-pressed={on}
              onClick={() => bulk.toggle(channel)}
              className={cn(
                "inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[9px] px-3 text-sm whitespace-nowrap transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent max-sm:h-10",
                on
                  ? "bg-surface-2 text-text smooth-shadow-ring-xs"
                  : "bg-bg text-muted [@media(hover:hover)]:hover:text-text",
              )}
            >
              {on && <Check aria-hidden size={13} className="shrink-0 text-accent" />}
              {channel.label}
            </button>
          );
        })}
      </div>
      {bulk.typedNote && <p className="mt-2 text-xs text-muted">{bulk.typedNote}</p>}
    </div>
  );
}

/** The links, and Copy all and Download beside their count. */
export function BulkOutput({ bulk }: { bulk: Bulk }) {
  const toast = useToast();
  const { links } = bulk.result;
  const all = links.map((link) => link.tagged).join("\n");
  return (
    <div className="flex flex-col gap-1 rounded-[14px] bg-bg p-1.5">
      <div className="flex flex-col gap-2 py-1 pl-2.5 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm text-muted" aria-live="polite">
          {links.length ? (
            <>
              <span className="tnum font-semibold text-text">
                {links.length.toLocaleString("en-US")}
              </span>{" "}
              {links.length === 1 ? "link" : "links"}
            </>
          ) : (
            "Paste one link per line to start."
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1.5 *:whitespace-nowrap max-sm:[&>button]:flex-1">
          <Button
            variant="outline"
            onClick={() => {
              if (!links.length) return bulk.refuse();
              // A failure has already said so in a toast.
              copyToClipboard(all, toast, {
                success: `Copied ${links.length} ${links.length === 1 ? "link" : "links"}`,
              }).catch(() => {});
              trackCta("utm_page_bulk_copy");
            }}
          >
            <Copy size={13} /> Copy all
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!links.length) return bulk.refuse();
              downloadCsv(bulkFilename(), bulkCsv(links));
              trackCta("utm_page_bulk_csv");
            }}
          >
            <Download size={13} /> Download CSV
          </Button>
        </div>
      </div>
      {links.length > 0 && (
        <ol
          aria-label="Tagged links"
          className="flex max-h-96 flex-col overflow-y-auto overscroll-contain rounded-[9px] bg-surface smooth-shadow-ring-xs"
        >
          {links.map((link) => (
            <li
              key={link.tagged}
              className="flex items-center gap-2 py-1.5 pr-1.5 pl-3 shadow-[inset_0_-1px_0_var(--border)] last:shadow-none"
            >
              <span className="min-w-0 flex-1 font-mono text-[13px] leading-relaxed break-all">
                <TaggedText tagged={link.tagged} />
              </span>
              <CopyButton
                text={link.tagged}
                label={`Copy ${link.tagged}`}
                onCopy={(text) => copyToClipboard(text, toast)}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** What the builder left out, said once: lines that are not addresses, and
 *  links past the cap. Null when nothing was. */
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
