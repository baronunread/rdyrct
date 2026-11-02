import { IconArrowRight } from "@tabler/icons-react";
import { useAddresses } from "../lib/hooks";
import { relativeDate, shortDate } from "../lib/dates";
import { copyToClipboard } from "../lib/clipboard";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { ShortAddress } from "./short-address";
import { readableUrl } from "../lib/display-url";
import type { LinkStats } from "@/shared/types";

/** Every other address that still leads to this link: aliases and the 48h
 * one a rename leaves behind. Nothing at all when there are none. An
 * address on the link's own host shows only its slug; the host is in the
 * page header, and repeating it pushed the slugs out of line. */
function OtherAddresses({ orgId, linkId, url }: { orgId: string; linkId: string; url: string }) {
  const host = new URL(url).host;
  const toast = useToast();
  const addresses = useAddresses(orgId, linkId);
  const others = (addresses.data ?? []).filter((a) => a.kind !== "primary" && !a.retiredAt);
  if (!others.length) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2">
      Also at
      <ul className="contents">
        {others.map((a) => (
          <li key={a.id} className="flex min-w-0 items-center text-text">
            <ShortAddress
              url={a.url}
              slug={a.slug}
              hideHost={new URL(a.url).host === host}
              className="text-sm"
            />
            <CopyButton
              text={a.url}
              label={`Copy ${a.url}`}
              onCopy={(text) => copyToClipboard(text, toast)}
            />
          </li>
        ))}
      </ul>
    </span>
  );
}

/** One line under a link's title: where it goes, who made it and when, its
 * last click, and where else it answers. Under the title rather than in a
 * side column, which left the page a hole below it. */
export function LinkFacts({
  orgId,
  stats: s,
  createdBy,
}: {
  orgId: string;
  stats: LinkStats;
  /** The creator's name, or null while the member list loads. */
  createdBy: string | null;
}) {
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      <a
        href={s.destination}
        target="_blank"
        rel="noreferrer"
        title={s.destination}
        className="flex max-w-full min-w-0 items-center gap-1 text-accent [@media(hover:hover)]:hover:underline"
      >
        <IconArrowRight size={14} aria-hidden className="shrink-0" />
        <span className="truncate">{readableUrl(s.destination)}</span>
      </a>
      <span>
        Created <span className="tnum text-text">{shortDate(s.createdAt)}</span>
        {createdBy && (
          <>
            {" "}
            by <span className="text-text">{createdBy}</span>
          </>
        )}
      </span>
      <span title={s.lastClick ? shortDate(s.lastClick) : undefined}>
        {s.lastClick ? (
          <>
            Last click <span className="text-text">{relativeDate(s.lastClick)}</span>
          </>
        ) : (
          "No clicks yet"
        )}
      </span>
      <OtherAddresses orgId={orgId} linkId={s.id} url={s.url} />
    </div>
  );
}
