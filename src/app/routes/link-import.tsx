/**
 * Import from another service (#383), on one page: pick where the links are
 * now, drop the file, say which domain they land on, import. Somebody moving
 * from Short.io, Bitly, Rebrandly or Dub ends with every short URL they ever
 * printed answering from rdyrct.
 *
 * The file is read here, and the rows go to the Worker in chunks: first to
 * be checked (nothing written, as soon as the file and its domains are
 * ready), then to be stored for a workflow that writes them on the server.
 * Once they are all sent, closing the page changes nothing; coming back
 * shows how far it got. A domain the file uses and the org lacks is set up
 * on the page, with TXT validation, so it is ready before its CNAME moves.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Link } from "@tanstack/react-router";
import { IconUpload } from "@tabler/icons-react";
import {
  CHECK_CHUNK_ROWS,
  IMPORT_SERVICES,
  chunkRows,
  detectColumns,
  hostsOf,
  isComplete,
  parseCsv,
  readRows,
  type ColumnMap,
  type ImportRow,
  type ImportServiceId,
  type ImportVerdict,
  type LinkImportDTO,
  type ReadResult,
  type UnreadableRow,
} from "@/shared/link-import";
import type { DomainDTO, OrgRole } from "@/shared/types";
import { api, ApiError } from "../lib/api";
import { useConfig, useDomains, useLinkImport, useLinkQuotaUsage } from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { useImportHistory, tableDate } from "../lib/links-data";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { Select } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Badge, PageHeader, Table, Td, Th } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { Segmented } from "../ui/segmented";
import { useToast } from "../ui/toast";
import { Check } from "../ui/icons";
import { cn } from "../ui/cn";
import { LockedPanel } from "../components/over-limit";
import { NoOrgState } from "../components/no-org";
import { DnsRecords } from "../components/dns-records";
import { CopyButton } from "../ui/copy-button";
import { copyToClipboard } from "../lib/clipboard";

const TITLE = "Import links";
const SUB = "Bring links from another shortener. Each one keeps its slug.";

/** The picker's order and names: the mock's, with "CSV" for any other
 * service's export (IMPORT_SERVICES calls it "Another service"). */
const SERVICE_TABS = [
  { id: "bitly", label: "Bitly" },
  { id: "shortio", label: "Short.io" },
  { id: "rebrandly", label: "Rebrandly" },
  { id: "dub", label: "Dub" },
  { id: "csv", label: "CSV" },
] as const satisfies readonly { id: ImportServiceId; label: string }[];

/** The most rows one import takes (the Worker's MAX_IMPORT_ROWS). */
const MAX_ROWS = 20_000;

/** Short domains that belong to the service itself. A link on one of them
 * cannot keep its domain (nobody but the service can point it here), so it
 * has to land on one of the org's own. */
const SERVICE_HOSTS = new Set([
  "bit.ly",
  "bitly.com",
  "j.mp",
  "short.io",
  "short.gy",
  "rebrand.ly",
  "rb.gy",
  "dub.sh",
  "dub.co",
  "dub.link",
]);

/** "Keep each link's own domain" in the Into domain select. */
const KEEP = "keep";

export function LinkImportPage() {
  const { org } = useOrgLimits();
  if (!org) return <NoOrgState />;
  if (org.plan === "free")
    return (
      <>
        <PageHeader title={TITLE} sub={SUB} />
        <LockedPanel
          title="Importing links is a paid feature"
          reason="Bring your links from Short.io, Bitly, Rebrandly or Dub with their short URLs unchanged. Each one keeps its own slug on your domain, which needs a paid plan."
        />
      </>
    );
  if (org.role === "viewer" || org.locked)
    return (
      <>
        <PageHeader title={TITLE} sub={SUB} />
        <LockedPanel
          title={org.locked ? "This organization is read-only" : "Viewers can't import links"}
          reason={
            org.locked
              ? "Importing adds links, and a read-only organization takes no new ones. You can still export the links it has from Links."
              : "Ask an owner or admin of this organization to import, or to make you a member."
          }
        />
      </>
    );
  return <ImportPage orgId={org.id} role={org.role} />;
}

/** Everything the page knows about the chosen file. */
interface FileState {
  name: string;
  table: string[][];
  map: ColumnMap | null;
  hasHeader: boolean;
}

/** An import the server already has (running, or finished and not put away)
 * takes the form's place: it is what somebody returning here wants to see. */
function ImportPage({ orgId, role }: { orgId: string; role: OrgRole }) {
  const current = useLinkImport(orgId);
  const [switching, setSwitching] = useState(false);
  // One still uploading was cut off before its rows were all sent, and its
  // file is gone with that page: the next import replaces it.
  const job = current.data?.import;
  const live = job && job.status !== "uploading" ? job : null;
  // A domain verified over HTTP is one whose CNAME already reaches us: links
  // imported onto it answer at once, and there is no DNS left to switch.
  const domains = useDomains(orgId, role === "owner" || role === "admin");
  const servedHere = new Set(
    (domains.data ?? [])
      .filter((d) => d.status === "active" && d.validation !== "txt")
      .map((d) => d.hostname),
  );
  const dnsDone = !!live && live.hosts.length > 0 && live.hosts.every((h) => servedHere.has(h));

  return (
    <>
      <PageHeader title={TITLE} sub={SUB} />
      <div className="flex flex-col gap-6">
        {live ? (
          switching ? (
            <SwitchStep
              orgId={orgId}
              hosts={live.hosts}
              serviceName={serviceNameOf(live.service)}
            />
          ) : (
            <JobView
              orgId={orgId}
              job={live}
              onNext={dnsDone ? undefined : () => setSwitching(true)}
            />
          )
        ) : (
          !current.isPending && <ImportForm orgId={orgId} role={role} />
        )}
        <PastImports orgId={orgId} shown={live?.id} />
      </div>
    </>
  );
}

const serviceNameOf = (id: string | null) =>
  IMPORT_SERVICES.find((s) => s.id === id)?.name ?? "your old service";

function readFile(file: FileState | null): ReadResult {
  if (!file?.map) return { rows: [], unreadable: [] };
  const body = file.hasHeader ? file.table.slice(1) : file.table;
  return readRows(body, file.map, file.hasHeader ? 2 : 1);
}

/* ---------------- layout ---------------- */

/** One raised card holding a list, its rows split by inset hairlines
 * (rdyrct-design: shadows, not borders). */
const LIST_CARD =
  "flex flex-col overflow-hidden rounded-xl bg-surface smooth-shadow-ring-xs [&>*+*]:shadow-[inset_0_1px_0_var(--border)]";

/** A titled card with no footer strip: the page's two sections. */
function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-surface p-4 smooth-shadow-ring-xs sm:p-5",
        className,
      )}
    >
      <h2 className="text-base font-semibold text-balance">{title}</h2>
      {children}
    </section>
  );
}

function Nav({ next }: { next: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-3 pt-1">{next}</div>;
}

/* ---------------- the form ---------------- */

/** Where the rows stand: still to be checked, being checked, or checked with
 * a verdict per row and the room the plan has left. */
type CheckState =
  | { kind: "idle" }
  | { kind: "checking"; done: number; total: number }
  | { kind: "checked"; verdicts: ImportVerdict[]; room: number | null }
  | { kind: "failed"; message: string };

/** What the form says is wrong after Import, in the place it is wrong. */
type FormError = { at: "file" | "domains" | "rows"; message: string } | null;

// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- one form across the file, domain and row steps; split tracked in #422.
function ImportForm({ orgId, role }: { orgId: string; role: OrgRole }) {
  const { limits, activeDomains, defaultDomainId } = useOrgLimits();
  const quota = useLinkQuotaUsage(orgId);
  const toast = useToast();
  const qc = useQueryClient();
  const [service, setService] = useState<ImportServiceId>("bitly");
  const [file, setFile] = useState<FileState | null>(null);
  const [into, setInto] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const [error, setError] = useState<FormError>(null);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const dropRef = useRef<HTMLLabelElement>(null);

  const read = useMemo(() => readFile(file), [file]);
  const fileHosts = useMemo(() => hostsOf(read.rows), [read.rows]);

  // The select's starting point: a file on the service's own short domain
  // has to land somewhere of ours; one on the person's own domains keeps
  // them. Their own pick wins once they make one.
  const defaultHost =
    activeDomains.find((d) => d.id === defaultDomainId)?.hostname ?? activeDomains[0]?.hostname;
  const target =
    into ?? (fileHosts.some((h) => SERVICE_HOSTS.has(h)) && defaultHost ? defaultHost : KEEP);
  const keep = target === KEEP;

  // The rows as they will be sent: moved onto the chosen domain, or on
  // their own less any domain the person left out.
  const skippedSet = useMemo(() => new Set(skipped), [skipped]);
  const rows = useMemo(() => {
    if (!keep) return read.rows.map((row) => ({ ...row, host: target }));
    return read.rows.filter((row) => !skippedSet.has(row.host));
  }, [read.rows, keep, target, skippedSet]);

  const canManage = role === "owner" || role === "admin";
  const domains = useDomains(orgId, canManage);
  const byHost = new Map((domains.data ?? []).map((d) => [d.hostname, d]));
  // Hosts the file keeps that the org does not have ready. Members cannot
  // list the org's domains, so for them the check says which hosts it lacks.
  const waiting =
    keep && canManage
      ? fileHosts.filter((h) => !skippedSet.has(h) && byHost.get(h)?.status !== "active")
      : [];
  const domainsKey = (domains.data ?? []).map((d) => `${d.hostname}:${d.status}`).join();

  // Check as soon as there is something checkable: nothing is written, and
  // the answer is what the Import button and the hint need to say.
  useEffect(() => {
    if (!rows.length || waiting.length) {
      setCheck({ kind: "idle" });
      return;
    }
    let current = true;
    setCheck({ kind: "checking", done: 0, total: rows.length });
    void sendChunks(`/orgs/${orgId}/link-import/check`, rows, (done) => {
      if (current) setCheck({ kind: "checking", done, total: rows.length });
    })
      .then((result) => {
        if (current) setCheck({ kind: "checked", verdicts: result.verdicts, room: result.room });
      })
      .catch((e: Error) => {
        if (current)
          setCheck({
            kind: "failed",
            message: e instanceof ApiError ? e.message : "Could not check the file",
          });
      });
    return () => {
      current = false;
    };
    // `waiting` is derived from domainsKey; listing the key keeps a new
    // array each render from re-running the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, rows, waiting.length, domainsKey]);

  const verdicts = check.kind === "checked" ? check.verdicts : [];
  const readyLines = new Set(verdicts.filter((v) => v.status === "ready").map((v) => v.line));
  const ready = rows.filter((row) => readyLines.has(row.line));
  const exists = verdicts.filter((v) => v.status === "exists").length;
  const room =
    check.kind === "checked" && check.room !== null
      ? check.room
      : Math.max(0, limits.links - (quota.data?.count ?? 0));
  const fits = Math.min(room, ready.length);
  const problems = problemsOf(rows, verdicts, read.unreadable);

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const table = parseCsv(await picked.text());
    setError(null);
    setSkipped([]);
    if (!table.length) {
      setFile(null);
      setError({ at: "file", message: "That file has no rows" });
      return;
    }
    if (table.length - 1 > MAX_ROWS) {
      setFile(null);
      setError({ at: "file", message: `Over ${MAX_ROWS.toLocaleString("en-US")} links` });
      return;
    }
    setFile({ name: picked.name, table, map: detectColumns(table[0]), hasHeader: true });
  };

  const submit = async () => {
    if (!file || !read.rows.length) {
      setError({ at: "file", message: file ? "No links in this file" : "Choose a file first" });
      dropRef.current?.focus();
      return;
    }
    if (waiting.length) {
      setError({ at: "domains", message: "Add these domains first, or leave them out" });
      return;
    }
    if (check.kind !== "checked" || !fits) {
      setError({
        at: "rows",
        message:
          check.kind === "checking"
            ? "Still checking the file"
            : check.kind === "failed"
              ? check.message
              : "None of these links can import",
      });
      return;
    }
    setError(null);
    const send = ready.slice(0, fits);
    setSending({ done: 0, total: send.length });
    try {
      await upload(orgId, service, send, (done) => setSending({ done, total: send.length }));
      await qc.invalidateQueries({ queryKey: ["link-import", orgId] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
      setSending(null);
    }
  };

  const serviceName = SERVICE_TABS.find((s) => s.id === service)?.label ?? "CSV";
  const info = IMPORT_SERVICES.find((s) => s.id === service);
  const n = (v: number) => v.toLocaleString("en-US");

  if (sending)
    return (
      <Section title="Sending your links">
        <Progress done={sending.done} total={sending.total} label="Sent" />
        <p className="max-w-prose text-sm text-pretty text-muted">
          Keep this page open until they are all sent. The import then carries on without it.
        </p>
      </Section>
    );

  return (
    <Section title="From">
      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented
          label="Where your links are now"
          items={SERVICE_TABS}
          value={service}
          onChange={(id) => setService(id)}
        />
      </div>

      <DropZone
        ref={dropRef}
        serviceName={service === "csv" ? "CSV" : `${serviceName}`}
        file={file}
        found={read.rows.length}
        error={error?.at === "file" ? error.message : undefined}
        onFile={(f) => void choose(f)}
      />
      {info && (
        <details className="group -mt-1 text-sm">
          <summary className="w-fit cursor-pointer text-xs text-muted [@media(hover:hover)]:hover:text-text">
            How to export from {info.name}
          </summary>
          <ol className="mt-2 flex max-w-prose list-decimal flex-col gap-1 pl-5 text-pretty text-muted">
            {info.steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </details>
      )}
      {file && !file.map && <ColumnPicker file={file} onChange={setFile} />}

      {activeDomains.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span id="into-domain" className="text-xs text-muted">
            Into domain
          </span>
          <div className="w-full sm:w-72">
            <MenuSelect
              label="Into domain"
              value={target}
              onChange={(value) => setInto(value)}
              options={[
                { value: KEEP, label: "Keep each link's domain" },
                ...activeDomains.map((d) => ({ value: d.hostname, label: d.hostname })),
              ]}
            />
          </div>
        </div>
      )}

      {keep && fileHosts.length > 0 && (waiting.length > 0 || skipped.length > 0) && (
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline justify-between gap-3 text-xs text-muted">
            The domains in this file
            {error?.at === "domains" && <span className="text-danger">{error.message}</span>}
          </p>
          <ul className={LIST_CARD}>
            {fileHosts.map((host) => (
              <li key={host}>
                {SERVICE_HOSTS.has(host) && !skippedSet.has(host) ? (
                  <ServiceHostRow
                    host={host}
                    links={read.rows.filter((r) => r.host === host).length}
                    hasDomains={activeDomains.length > 0}
                    onSkip={() => setSkipped([...skipped, host])}
                  />
                ) : (
                  <DomainRow
                    orgId={orgId}
                    host={host}
                    links={read.rows.filter((r) => r.host === host).length}
                    domain={byHost.get(host)}
                    canManage={canManage}
                    skipped={skippedSet.has(host)}
                    onSkip={(skip) =>
                      setSkipped(skip ? [...skipped, host] : skipped.filter((h) => h !== host))
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {check.kind === "checked" && (problems.length > 0 || exists > 0) && (
        <CheckSummary
          fits={fits}
          exists={exists}
          left={problems.length + (ready.length - fits)}
          problems={problems}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <ImportHint
          check={check}
          room={room}
          ready={ready.length}
          fits={fits}
          error={error?.at === "rows" ? error.message : undefined}
          unlimited={limits.links >= 1_000_000}
        />
        <Button
          variant="primary"
          size="sm"
          className="max-sm:h-11 max-sm:w-full"
          onClick={() => void submit()}
        >
          {check.kind === "checked" && fits > 0
            ? `Import ${n(fits)} ${fits === 1 ? "link" : "links"}`
            : "Import"}
        </Button>
      </div>
    </Section>
  );
}

/**
 * A host that belongs to the old service (bit.ly, dub.sh): nobody else can
 * point it here, so its links need one of the org's own domains, picked in
 * Into domain, or a domain added first.
 */
function ServiceHostRow({
  host,
  links,
  hasDomains,
  onSkip,
}: {
  host: string;
  links: number;
  hasDomains: boolean;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-sm break-all">{host}</span>
          <span className="tnum text-xs text-muted">
            {links.toLocaleString("en-US")} {links === 1 ? "link" : "links"}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Leave these out
        </Button>
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted">
        {hasDomains ? (
          <>Links on {host} can't keep its domain. Pick one of yours under Into domain.</>
        ) : (
          <>
            Links on {host} can't keep its domain, and they need one of yours.{" "}
            <Link to="/domains" className="text-accent [@media(hover:hover)]:hover:underline">
              Add a domain
            </Link>{" "}
            first.
          </>
        )}
      </p>
    </div>
  );
}

/** The line beside Import: the plan's room before a file, the check's
 * progress while it runs, and what will happen once it is done. */
function ImportHint({
  check,
  room,
  ready,
  fits,
  error,
  unlimited,
}: {
  check: CheckState;
  room: number;
  ready: number;
  fits: number;
  error?: string;
  unlimited: boolean;
}) {
  const n = (v: number) => v.toLocaleString("en-US");
  if (error) return <span className="text-sm text-danger">{error}</span>;
  if (check.kind === "checking")
    return (
      <span className="tnum text-sm text-muted">
        Checking {n(check.done)} of {n(check.total)}. Nothing is written yet.
      </span>
    );
  if (check.kind === "failed") return <span className="text-sm text-danger">{check.message}</span>;
  if (check.kind === "checked" && fits < ready)
    return (
      <span className="text-sm text-pretty">
        Your plan has room for {n(fits)} more links, so the last {n(ready - fits)} will be left out.{" "}
        <Link to="/billing" className="text-accent [@media(hover:hover)]:hover:underline">
          See plans
        </Link>
      </span>
    );
  if (check.kind === "checked")
    return (
      <span className="text-sm text-muted">
        Clicks start from zero here. Your old service keeps the history.
      </span>
    );
  if (unlimited) return <span />;
  return (
    <span className="tnum text-sm text-muted">
      Your plan has room for {n(room)} more {room === 1 ? "link" : "links"}.
    </span>
  );
}

/** Rows that will not import, behind a count: the person mostly wants the
 * number, and the reasons when it is not zero. */
function CheckSummary({
  fits,
  exists,
  left,
  problems,
}: {
  fits: number;
  exists: number;
  left: number;
  problems: { line: number; address: string; reason: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <Totals
        items={[
          { label: "Will import", value: fits },
          { label: "Already on rdyrct", value: exists },
          { label: "Won't import", value: left },
        ]}
      />
      {problems.length > 0 && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer text-xs text-muted [@media(hover:hover)]:hover:text-text">
            Why{" "}
            {problems.length === 1
              ? "one link"
              : `${problems.length.toLocaleString("en-US")} links`}{" "}
            won't import
          </summary>
          <div className="mt-3">
            <Problems rows={problems} />
          </div>
        </details>
      )}
    </div>
  );
}

/** The dashed box: drop the export on it, or click to choose. */
function DropZone({
  ref,
  serviceName,
  file,
  found,
  error,
  onFile,
}: {
  ref: Ref<HTMLLabelElement>;
  serviceName: string;
  file: FileState | null;
  found: number;
  error?: string;
  onFile: (file: File | undefined) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      ref={ref}
      tabIndex={-1}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2 rounded-xl px-4 py-7 text-center outline-[1.5px] -outline-offset-[1.5px] outline-dashed transition-[background-color,outline-color] duration-150 focus-within:outline-2 focus-within:outline-accent focus-within:outline-solid [@media(hover:hover)]:hover:bg-surface-2/40",
        error ? "outline-danger" : "outline-border",
        over && "bg-surface-2/60 outline-accent",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        className="sr-only"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "drop-error" : undefined}
        onChange={(event) => onFile(event.target.files?.[0])}
      />
      {file ? (
        <>
          <Check size={20} className="text-accent-2" aria-hidden />
          <span className="font-mono text-sm break-all">{file.name}</span>
          <span className="tnum text-xs text-muted">
            {found.toLocaleString("en-US")} {found === 1 ? "link" : "links"} found. Choose another
            file to replace it.
          </span>
        </>
      ) : (
        <>
          <IconUpload size={20} stroke={1.75} className="text-placeholder" aria-hidden />
          <span className="text-sm font-semibold">
            {serviceName === "CSV"
              ? "Drop your CSV file here"
              : `Drop your ${serviceName} export here`}
          </span>
          <span className="text-xs text-muted">
            or <span className="text-text underline underline-offset-2">choose a file</span>. CSV,
            up to {MAX_ROWS.toLocaleString("en-US")} links.
          </span>
        </>
      )}
      {error && (
        <span id="drop-error" className="text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

/* ---------------- past imports ---------------- */

/** Imports this org finished, less the one the page shows above (`shown`).
 * Hidden when there are none. */
function PastImports({ orgId, shown }: { orgId: string; shown?: string }) {
  const history = useImportHistory(orgId);
  const imports = (history.data?.imports ?? []).filter((item) => item.id !== shown);
  if (!imports.length) return null;
  return (
    <Section title="Past imports">
      <ul className="-mt-1 flex flex-col [&>*+*]:shadow-[inset_0_1px_0_var(--border)]">
        {imports.map((item) => {
          const total = item.imported + item.exists;
          const skips = item.failed;
          return (
            <li
              key={item.id}
              className="grid min-h-10 grid-cols-[minmax(0,5.5rem)_1fr_auto] items-center gap-x-3 py-2 text-sm sm:grid-cols-[6rem_1fr_auto_auto]"
            >
              <span className="truncate font-semibold">{serviceTabName(item.service)}</span>
              <span className="tnum truncate text-muted">
                {total.toLocaleString("en-US")} {total === 1 ? "link" : "links"}
                {skips ? `, ${skips.toLocaleString("en-US")} skipped` : ""}
              </span>
              <span className="tnum text-muted max-sm:hidden">{tableDate(item.finishedAt)}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap",
                  skips ? "text-butter" : "text-accent-2",
                )}
              >
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                {skips ? "Done with skips" : "Done"}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const serviceTabName = (id: string) => SERVICE_TABS.find((s) => s.id === id)?.label ?? "CSV";

/* ---------------- kept from the step-by-step page ---------------- */

/** For a header we do not know: the person says which column is which. */
function ColumnPicker({
  file,
  onChange,
}: {
  file: FileState;
  onChange: (file: FileState) => void;
}) {
  const [draft, setDraft] = useState<ColumnMap>({
    shortUrl: null,
    customShortUrl: null,
    domain: null,
    slug: null,
    destination: null,
    title: null,
  });
  const width = Math.max(...file.table.slice(0, 5).map((row) => row.length));
  const names = Array.from({ length: width }, (_, index) =>
    file.hasHeader && file.table[0][index] ? file.table[0][index] : `Column ${index + 1}`,
  );
  const pick = (key: "shortUrl" | "destination" | "title") => (
    <Select
      value={draft[key] ?? ""}
      onChange={(event) =>
        setDraft({ ...draft, [key]: event.target.value === "" ? null : Number(event.target.value) })
      }
    >
      <option value="">{key === "title" ? "None" : "Choose a column"}</option>
      {names.map((name, index) => (
        <option key={`${name}-${index}`} value={index}>
          {name}
        </option>
      ))}
    </Select>
  );
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 smooth-shadow-ring-xs">
      <p className="text-sm font-medium">We could not tell which column is which. Pick them:</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Short URL
          {pick("shortUrl")}
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Where it goes
          {pick("destination")}
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Title (optional)
          {pick("title")}
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={file.hasHeader}
          onChange={(event) => onChange({ ...file, hasHeader: event.target.checked })}
        />
        The first row names the columns
      </label>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={!isComplete(draft)}
          onClick={() => onChange({ ...file, map: draft })}
        >
          Use these columns
        </Button>
      </div>
    </div>
  );
}

function DomainRow({
  orgId,
  host,
  links,
  domain,
  canManage,
  skipped,
  onSkip,
}: {
  orgId: string;
  host: string;
  links: number;
  domain: DomainDTO | undefined;
  canManage: boolean;
  skipped: boolean;
  onSkip: (skip: boolean) => void;
}) {
  const pending = domain?.validation === "txt" && domain.status !== "active";
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-sm break-all">{host}</span>
          <span className="tnum text-xs text-muted">
            {links.toLocaleString()} {links === 1 ? "link" : "links"}
          </span>
        </div>
        {domain ? (
          <Badge color={domain.status === "active" ? "mint" : "butter"}>
            {domainState(domain)}
          </Badge>
        ) : (
          <HostActions
            orgId={orgId}
            host={host}
            canManage={canManage}
            skipped={skipped}
            onSkip={onSkip}
          />
        )}
      </div>
      {!domain && !skipped && !canManage && (
        <p className="text-sm text-muted">
          Only an owner or admin can add a domain. If {host} is not on rdyrct yet, ask one to add
          it. The next step shows which links can import.
        </p>
      )}
      {domain && pending && (
        <div className="flex flex-col gap-2">
          <p className="max-w-prose text-sm text-pretty">
            Add these two TXT records at your DNS provider now. They prove the domain is yours and
            let us issue its certificate, while your links still point at the old service. Leave the
            CNAME alone until the last step.
          </p>
          <DnsRecords orgId={orgId} domain={domain} showCname={false} />
        </div>
      )}
    </div>
  );
}

function domainState(domain: DomainDTO) {
  if (domain.status === "active") return "Ready";
  return domain.validation === "txt" ? "Waiting for TXT records" : "Waiting for DNS";
}

/** What can be done about a domain the org does not have yet. */
function HostActions({
  orgId,
  host,
  canManage,
  skipped,
  onSkip,
}: {
  orgId: string;
  host: string;
  canManage: boolean;
  skipped: boolean;
  onSkip: (skip: boolean) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const add = async () => {
    setAdding(true);
    try {
      await api<DomainDTO>(`/orgs/${orgId}/domains`, {
        method: "POST",
        body: { hostname: host, validation: "txt" },
      });
      await qc.invalidateQueries({ queryKey: ["domains", orgId] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Something went wrong", "error");
    } finally {
      setAdding(false);
    }
  };

  if (skipped)
    return (
      <Button variant="ghost" size="sm" onClick={() => onSkip(false)}>
        Import these links after all
      </Button>
    );
  const leaveOut = (
    <Button variant="ghost" size="sm" onClick={() => onSkip(true)}>
      Leave these out
    </Button>
  );
  if (!canManage) return leaveOut;
  return (
    <div className="flex items-center gap-2">
      {leaveOut}
      <Button variant="outline" size="sm" disabled={adding} onClick={add}>
        <BusyContent busy={adding}>Add {host}</BusyContent>
      </Button>
    </div>
  );
}

/** Sends `rows` to `path` one chunk at a time, reporting progress. */
async function sendChunks(
  path: string,
  rows: ImportRow[],
  onProgress: (done: number) => void,
): Promise<{ verdicts: ImportVerdict[]; room: number | null }> {
  const verdicts: ImportVerdict[] = [];
  let room: number | null = null;
  let done = 0;
  // One after another, so the progress bar means something and a slow
  // connection is not asked to hold the whole file at once.
  await chunkRows(rows, CHECK_CHUNK_ROWS).reduce(
    (previous, chunk) =>
      previous.then(async () => {
        const result = await api<{ verdicts?: ImportVerdict[]; room?: number }>(path, {
          method: "POST",
          body: { rows: chunk },
        });
        verdicts.push(...(result.verdicts ?? []));
        room = result.room ?? room;
        done += chunk.length;
        onProgress(done);
      }),
    Promise.resolve(),
  );
  return { verdicts, room };
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const share = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface p-4 smooth-shadow-ring-xs">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="tnum">
          <span className="font-medium">{label}:</span>{" "}
          <span className="text-muted">
            {done.toLocaleString()} of {total.toLocaleString()}
          </span>
        </p>
        <span className="tnum text-xs text-muted" aria-hidden>
          {share}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={share}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

function Totals({ items }: { items: { label: string; value: number }[] }) {
  return (
    <dl
      className="grid overflow-hidden rounded-xl bg-surface smooth-shadow-ring-xs [&>*+*]:shadow-[inset_1px_0_0_var(--border)]"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col justify-between gap-0.5 px-3 py-3 sm:px-4">
          <dt className="text-xs text-pretty text-muted">{item.label}</dt>
          <dd className="tnum text-xl font-semibold tracking-tight sm:text-2xl">
            {item.value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const shortOf = (row: ImportRow) => `${row.host}/${row.slug}`;

/** Rows that will not import, with why. Long lists show their first 50. */
function Problems({
  rows,
  total = rows.length,
}: {
  rows: { line: number; address: string; reason: string }[];
  /** How many there are, when `rows` is only the first of them. */
  total?: number;
}) {
  if (!rows.length) return null;
  const shown = rows.slice(0, 50);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted">Won't import</h3>
      <ul className={cn(LIST_CARD, "sm:hidden")}>
        {shown.map((row) => (
          <li key={row.line} className="flex flex-col gap-1 px-4 py-2.5 text-sm">
            <span className="tnum text-xs text-muted">Line {row.line}</span>
            {row.address && <span className="font-mono text-xs break-all">{row.address}</span>}
            <span className="text-pretty">{row.reason}</span>
          </li>
        ))}
      </ul>
      <Table className="max-sm:hidden" minWidth="min-w-[36rem]">
        <thead>
          <tr>
            <Th className="w-16 text-right">Line</Th>
            <Th>Short URL</Th>
            <Th>Why</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.line} className="align-top">
              <Td className="tnum text-right text-muted">{row.line}</Td>
              <Td className="font-mono text-xs whitespace-nowrap">{row.address}</Td>
              <Td className="text-pretty">{row.reason}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {total > shown.length && (
        <p className="tnum text-sm text-muted">
          And {(total - shown.length).toLocaleString()} more like these.
        </p>
      )}
    </div>
  );
}

function problemsOf(rows: ImportRow[], verdicts: ImportVerdict[], unreadable: UnreadableRow[]) {
  const byLine = new Map(rows.map((row) => [row.line, row]));
  return [
    ...unreadable.map((row) => ({ line: row.line, address: "", reason: row.reason })),
    ...verdicts
      .filter((verdict) => verdict.status === "failed")
      .map((verdict) => {
        const row = byLine.get(verdict.line);
        return {
          line: verdict.line,
          address: row ? shortOf(row) : "",
          reason: verdict.reason ?? "",
        };
      }),
  ].sort((a, b) => a.line - b.line);
}

/** Creates the import, sends its rows and starts it. A second try starts a
 * new import, which replaces the one cut off. */
async function upload(
  orgId: string,
  service: ImportServiceId,
  rows: ImportRow[],
  onProgress: (done: number) => void,
) {
  const base = `/orgs/${orgId}/link-import`;
  const { id } = await api<{ id: string }>(base, {
    method: "POST",
    body: { service, total: rows.length },
  });
  await sendChunks(`${base}/${id}/rows`, rows, onProgress);
  await api(`${base}/${id}/start`, { method: "POST" });
}

/** An import the server is running or has finished, read from the server, so
 * it looks the same after a reload or on another device. */
function JobView({
  orgId,
  job,
  onNext,
}: {
  orgId: string;
  job: LinkImportDTO;
  /** To the DNS step; undefined when every domain already points here. */
  onNext?: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"retry" | "new" | null>(null);

  useEffect(() => {
    if (job.status !== "done") return;
    void qc.invalidateQueries({ queryKey: ["links", orgId] });
    void qc.invalidateQueries({ queryKey: ["link-import", orgId, "history"] });
  }, [job.status, orgId, qc]);

  const act = (kind: "retry" | "new") => {
    setBusy(kind);
    api(`/orgs/${orgId}/link-import/${job.id}/${kind === "new" ? "dismiss" : "retry"}`, {
      method: "POST",
    })
      // Put away, it drops out of /current and the page offers a new import.
      .then(() => qc.invalidateQueries({ queryKey: ["link-import", orgId] }))
      .catch((error: Error) =>
        toast(error instanceof ApiError ? error.message : "Something went wrong", "error"),
      )
      .finally(() => setBusy(null));
  };

  if (job.status === "running")
    return (
      <Section title="Importing your links">
        <Progress done={job.total - job.pending} total={job.total} label="Imported" />
        <p className="max-w-prose text-sm text-pretty text-muted">
          This runs on our side, so you can close the page. Come back to Import to see how it went.
        </p>
      </Section>
    );

  const imported = job.imported + job.exists;
  return (
    <Section title={job.failed ? "Most of your links are in" : "Your links are in"}>
      <Totals
        items={[
          { label: "Imported", value: imported },
          { label: "Didn't import", value: job.failed },
        ]}
      />
      <p className="max-w-prose text-sm text-pretty text-muted">
        {onNext
          ? "They answer as soon as their domain points at rdyrct, which is the next step."
          : "Their domain already points at rdyrct, so they answer now."}
      </p>
      <Problems
        rows={job.failures.map((row) => ({
          line: row.line,
          address: `${row.host}/${row.slug}`,
          reason: row.reason,
        }))}
        total={job.failed}
      />
      <Nav
        next={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" disabled={!!busy} onClick={() => act("new")}>
              <BusyContent busy={busy === "new"}>Import another file</BusyContent>
            </Button>
            {job.failed > 0 && (
              <Button variant="outline" disabled={!!busy} onClick={() => act("retry")}>
                <BusyContent busy={busy === "retry"}>
                  Try those {job.failed.toLocaleString()} again
                </BusyContent>
              </Button>
            )}
            {onNext ? (
              <Button variant="primary" disabled={!!busy} onClick={onNext}>
                Next: switch the DNS
              </Button>
            ) : (
              <Link to="/links" className={buttonClass({ variant: "primary" })}>
                Go to your links
              </Link>
            )}
          </div>
        }
      />
    </Section>
  );
}

function SwitchStep({
  orgId,
  hosts,
  serviceName,
}: {
  orgId: string;
  hosts: string[];
  serviceName: string;
}) {
  const toast = useToast();
  const domains = useDomains(orgId);
  const config = useConfig();
  const appHost = config.data?.appHost ?? window.location.host;
  const byHost = new Map((domains.data ?? []).map((domain) => [domain.hostname, domain]));

  return (
    <Section title="Last step: point your domains at rdyrct">
      <p className="max-w-prose text-sm text-pretty text-muted">
        Your links are on rdyrct. Until you change the DNS, people still reach them through{" "}
        {serviceName}.
      </p>
      <ul className={LIST_CARD}>
        {hosts.map((host) => {
          const domain = byHost.get(host);
          if (!domain) return null;
          const ready = domain.status === "active";
          return (
            <li key={host} className="flex flex-col gap-3 px-4 py-3">
              <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-sm break-all">{host}</span>
                <Badge color={ready ? "mint" : "butter"}>
                  {ready ? "Ready to switch" : "Waiting for the TXT records"}
                </Badge>
              </div>
              {ready ? (
                <>
                  <p className="max-w-prose text-sm text-pretty">
                    The certificate is issued. At your DNS provider, change the CNAME for {host} to
                    the value below. Your links answer from rdyrct as soon as it takes effect, with
                    no gap.
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-3 text-sm">
                    <code className="font-mono text-xs break-all">
                      {host} CNAME {appHost}
                    </code>
                    <CopyButton
                      text={appHost}
                      label="Copy CNAME target"
                      onCopy={(text) => copyToClipboard(text, toast)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="max-w-prose text-sm text-pretty">
                    We have not seen the TXT records yet. Once they are in, the certificate is
                    issued and this turns ready, usually within minutes.
                  </p>
                  <DnsRecords orgId={orgId} domain={domain} showCname={false} />
                </>
              )}
            </li>
          );
        })}
      </ul>
      <Nav
        next={
          <Link to="/links" className={buttonClass({ variant: "primary" })}>
            Go to your links
          </Link>
        }
      />
    </Section>
  );
}
