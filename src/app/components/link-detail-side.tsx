import type { ReactNode } from "react";
import { useAddresses } from "../lib/hooks";
import { relativeDate, shortDate } from "../lib/dates";
import { copyToClipboard } from "../lib/clipboard";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { ExportCsvButton } from "./export-csv-button";
import { ShortAddress } from "./short-address";
import { readableUrl } from "../lib/display-url";
import type { LinkStats } from "@/shared/types";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}

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
    <Fact label="Also answers at">
      <ul className="flex flex-col">
        {others.map((a) => (
          <li key={a.id} className="flex min-w-0 items-center justify-between gap-1">
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
    </Fact>
  );
}

/** The side column of a link's page: where it goes, where else it answers,
 * who made it and when, and the export of the stats beside it. */
export function LinkDetailSide({
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
    <aside className="flex flex-col gap-4 rounded-xl bg-surface p-4 smooth-shadow-ring-xs">
      <Fact label="Destination">
        <a
          href={s.destination}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-accent [overflow-wrap:anywhere] hover:underline"
        >
          {readableUrl(s.destination)}
        </a>
      </Fact>
      <OtherAddresses orgId={orgId} linkId={s.id} url={s.url} />
      <div className="grid grid-cols-2 gap-3">
        <Fact label="Created">
          <span className="tnum text-sm">{shortDate(s.createdAt)}</span>
        </Fact>
        {createdBy && (
          <Fact label="By">
            <span className="truncate text-sm" title={createdBy}>
              {createdBy}
            </span>
          </Fact>
        )}
      </div>
      <Fact label="Last click">
        <span className="text-sm" title={s.lastClick ? shortDate(s.lastClick) : undefined}>
          {s.lastClick ? relativeDate(s.lastClick) : "No clicks yet"}
        </span>
      </Fact>
      <div>
        <ExportCsvButton stats={s} scope={`link-${s.slug}`} days={s.rangeDays} />
      </div>
    </aside>
  );
}
