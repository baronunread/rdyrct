import type { DomainDTO } from "@/shared/types";
import { useDomainRecords } from "../lib/hooks";
import { copyToClipboard } from "../lib/clipboard";
import { CopyButton } from "../ui/copy-button";
import { Skeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";

/**
 * The DNS records a domain needs, each with a copy button, as a small table:
 * type, name and value, the three things a DNS provider's form asks for.
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
      <div className="flex flex-col gap-2" aria-busy>
        <p className="text-sm text-muted">
          Cloudflare is preparing the records for {domain.hostname}. This takes a few seconds.
        </p>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );

  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border sm:hidden">
        {list.map((record) => (
          <li
            key={`${record.type}-${record.name}`}
            className="flex flex-col gap-2 px-3 py-2.5 text-sm"
          >
            <span className="text-xs text-muted">{record.type} record</span>
            <span className="flex items-start gap-1.5">
              <span className="w-12 shrink-0 text-xs text-muted">Name</span>
              <code className="min-w-0 flex-1 font-mono text-xs break-all">{record.name}</code>
              <CopyButton text={record.name} label="Copy name" onCopy={copy} />
            </span>
            <span className="flex items-start gap-1.5">
              <span className="w-12 shrink-0 text-xs text-muted">Value</span>
              <code className="min-w-0 flex-1 font-mono text-xs break-all">{record.value}</code>
              <CopyButton text={record.value} label="Copy value" onCopy={copy} />
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-md border border-border sm:block">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-normal">Type</th>
              <th className="px-3 py-2 font-normal">Name</th>
              <th className="px-3 py-2 font-normal">Value</th>
            </tr>
          </thead>
          <tbody>
            {list.map((record) => (
              <tr key={`${record.type}-${record.name}`} className="border-t border-border">
                <td className="px-3 py-2 align-top">{record.type}</td>
                <td className="px-3 py-2 align-top">
                  <span className="flex items-center gap-1.5">
                    <code className="font-mono text-xs break-all">{record.name}</code>
                    <CopyButton text={record.name} label="Copy name" onCopy={copy} />
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="flex items-center gap-1.5">
                    <code className="font-mono text-xs break-all">{record.value}</code>
                    <CopyButton text={record.value} label="Copy value" onCopy={copy} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
