/**
 * The admin audit log (#67), on a tab of its own.
 *
 * It answers "who did this, and why" about the whole platform, not only about
 * links, so it does not belong inside the Links screen: bans, comps and org
 * deletions are recorded here too.
 */
import { useAdminAudit } from "../../lib/hooks";
import { Card, PageHeader, Table, Td, Th } from "../../ui/misc";
import { AdminTableSkeleton } from "../../components/skeletons";
import { shortDate } from "../../lib/dates";

export function AdminAuditPage() {
  const { data, isPending } = useAdminAudit();
  const rows = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit log"
        sub="Every privileged action, newest first. Append-only: entries are never edited or removed."
      />
      <Card>
        {isPending ? (
          <AdminTableSkeleton />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <Table fixed>
            <thead>
              <tr>
                <Th className="w-36">When</Th>
                <Th className="w-56">Who</Th>
                <Th className="w-44">Action</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <Td className="whitespace-nowrap text-muted">{shortDate(entry.createdAt)}</Td>
                  {/* The address may be gone: the log outlives the account. */}
                  <Td className="truncate">
                    {entry.actorEmail ?? <span className="text-muted">deleted account</span>}
                  </Td>
                  <Td className="font-mono text-xs whitespace-nowrap">{entry.action}</Td>
                  <Td className="truncate text-muted" title={entry.detail ?? entry.targetId}>
                    {entry.detail ?? entry.targetId}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
