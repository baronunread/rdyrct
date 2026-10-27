import type { ReactNode } from "react";
import { useAddresses } from "../lib/hooks";
import { relativeDate, shortDate } from "../lib/dates";
import { copyToClipboard } from "../lib/clipboard";
import { linkDisplayTitle } from "../lib/link-display";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { ExportCsvButton } from "./export-csv-button";
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
 * one a rename leaves behind. Nothing at all when there are none. */
function OtherAddresses({ orgId, linkId }: { orgId: string; linkId: string }) {
  const toast = useToast();
  const addresses = useAddresses(orgId, linkId);
  const others = (addresses.data ?? []).filter((a) => a.kind !== "primary" && !a.retiredAt);
  if (!others.length) return null;
  return (
    <Fact label="Also answers at">
      <ul className="flex flex-col">
        {others.map((a) => (
          <li key={a.id} className="flex min-w-0 items-center justify-between gap-1">
            <span className="truncate font-mono text-sm" title={a.url}>
              {linkDisplayTitle(a.url)}
            </span>
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
          {s.destination}
        </a>
      </Fact>
      <OtherAddresses orgId={orgId} linkId={s.id} />
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
