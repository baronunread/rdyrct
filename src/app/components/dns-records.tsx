import type { DomainDTO } from "@/shared/types";
import { useDomainRecords } from "../lib/hooks";
import { copyToClipboard } from "../lib/clipboard";
import { CopyButton } from "../ui/copy-button";
import { Skeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";

/**
 * The DNS records a domain needs, one line each with its own copy button
 * (RecordLine): type, name and value, what a DNS provider's form asks for.
 *
 * A domain moving from another service (#383, `validation: "txt"`) lists its
 * two TXT records first. They prove the domain is yours and let us issue its
 * certificate while it still points at the old service, so `showCname` is
 * false until the person is ready to switch.
 */
export function DnsRecords({
  orgId,
  domain,
  showCname = true,
}: {
  orgId: string;
  domain: DomainDTO;
  showCname?: boolean;
}) {
  const toast = useToast();
  const copy = (text: string) => copyToClipboard(text, toast);
  const records = useDomainRecords(orgId, domain.id);
  const list = (records.data?.records ?? []).filter(
    (record) => showCname || record.type !== "CNAME",
  );
  const waitingForTxt =
    domain.validation === "txt" && !records.data?.records.some((record) => record.type === "TXT");

  if (records.isPending || (waitingForTxt && domain.status !== "active"))
    return (
      <div className="flex flex-col gap-1.5" aria-busy>
        <p className="text-sm text-muted">
          Cloudflare is preparing the records for {domain.hostname}. This takes a few seconds.
        </p>
        <Skeleton className="h-11 w-full rounded-[10px]" />
        <Skeleton className="h-11 w-full rounded-[10px]" />
      </div>
    );

  return (
    <div className="flex flex-col gap-1.5">
      {list.map((record) => (
        <RecordLine
          key={`${record.type}-${record.name}`}
          type={record.type}
          name={record.name}
          value={record.value}
          onCopy={copy}
        />
      ))}
    </div>
  );
}

/**
 * One DNS record on one line, the way Domains shows a CNAME: its type, the
 * name and where it points, and one copy button that copies the whole record
 * as a message for whoever manages the DNS. Long names and values truncate,
 * with the full text on hover; the copy always carries all of it.
 */
export function RecordLine({
  type,
  name,
  value,
  onCopy,
}: {
  type: string;
  name: string;
  value: string;
  onCopy: (text: string) => void | Promise<void>;
}) {
  return (
    <div
      data-record={type}
      className="@container flex min-h-11 min-w-0 items-center gap-3 rounded-[10px] bg-bg py-1 pr-1 pl-3 shadow-[inset_0_0_0_1px_var(--border)]"
    >
      <span className="shrink-0 rounded-[5px] px-1.5 text-[11px] text-muted shadow-[inset_0_0_0_1px_var(--border)]">
        {type}
      </span>
      {/* One line where there is room; on a narrow card the value goes under
          the name, so neither truncates to nothing. */}
      <div className="flex min-w-0 flex-1 flex-col py-1 font-mono text-[13px] @lg:flex-row @lg:items-center @lg:gap-3 @lg:py-0">
        <code title={name} className="min-w-0 truncate @lg:max-w-[55%]">
          {name}
        </code>
        <span aria-hidden className="shrink-0 text-placeholder @max-lg:hidden">
          →
        </span>
        <code title={value} className="min-w-0 truncate text-muted @lg:flex-1 @lg:text-text">
          {value}
        </code>
      </div>
      <CopyButton
        text={`Type: ${type}\nName: ${name}\nValue: ${value}`}
        label="Copy the record"
        onCopy={onCopy}
      />
    </div>
  );
}
