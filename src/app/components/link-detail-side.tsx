import { IconArrowRight } from "@tabler/icons-react";
import { useAddresses } from "../lib/hooks";
import { copyToClipboard } from "../lib/clipboard";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { ShortAddress } from "./short-address";
import { readableUrl } from "../lib/display-url";
import type { LinkStats } from "@/shared/types";
import { OverflowTip } from "@/app/ui/overflow-tip";

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

export function LinkFacts({ orgId, stats: s }: { orgId: string; stats: LinkStats }) {
  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      <OverflowTip content={s.destination}>
        <a
          href={s.destination}
          target="_blank"
          rel="noreferrer"
          className="flex max-w-full min-w-0 items-center gap-1 text-accent [@media(hover:hover)]:hover:underline"
        >
          <IconArrowRight size={14} aria-hidden className="shrink-0" />
          <span className="truncate">{readableUrl(s.destination)}</span>
        </a>
      </OverflowTip>
      <OtherAddresses orgId={orgId} linkId={s.id} url={s.url} />
    </div>
  );
}
