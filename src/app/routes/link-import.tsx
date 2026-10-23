/**
 * Import from another service (#383): one step at a time, from "where are
 * your links now" to "switch the DNS", so somebody moving from Short.io,
 * Bitly, Rebrandly or Dub ends with every short URL they ever printed
 * answering from rdyrct.
 *
 * The file is read here, and the rows go to the Worker in chunks: first to
 * be checked (nothing written), then to be stored for a workflow that writes
 * them on the server. Once they are all sent, closing the page changes
 * nothing; coming back shows how far it got. A domain the file uses and the org lacks is set up inside the
 * flow, with TXT validation, so it is ready before its CNAME moves.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
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
import { resolveUtm, stripUtmParams, UTM_KEYS } from "@/shared/utm";
import type { DomainDTO, OrgRole } from "@/shared/types";
import { api, ApiError } from "../lib/api";
import { useConfig, useDomains, useLinkImport } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { Select } from "../ui/field";
import { Badge, PageHeader } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { Check, ChevronRight } from "../ui/icons";
import { cn } from "../ui/cn";
import { LockedPanel } from "../components/over-limit";
import { NoOrgState } from "../components/no-org";
import { DnsRecords } from "../components/dns-records";
import { CopyButton } from "../ui/copy-button";
import { copyToClipboard } from "../lib/clipboard";

type Step = "service" | "file" | "domains" | "check" | "import" | "switch";

const STEPS: { id: Step; label: string }[] = [
  { id: "service", label: "Where from" },
  { id: "file", label: "Your file" },
  { id: "domains", label: "Domains" },
  { id: "check", label: "Check" },
  { id: "import", label: "Import" },
  { id: "switch", label: "Switch DNS" },
];

export function LinkImportPage() {
  const { org } = useCurrentOrg();
  if (!org) return <NoOrgState />;
  if (org.plan === "free")
    return (
      <>
        <PageHeader title="Import from another service" />
        <LockedPanel
          title="Importing links is a paid feature"
          reason="Bring your links from Short.io, Bitly, Rebrandly or Dub with their short URLs unchanged. Each one keeps its own slug on your domain, which needs a paid plan."
        />
      </>
    );
  return <ImportFlow orgId={org.id} role={org.role} />;
}

/** Everything the steps hand to each other. */
interface FileState {
  name: string;
  table: string[][];
  map: ColumnMap | null;
  hasHeader: boolean;
}

/** An import the server already has (running, or finished and not put away)
 * comes first: it is what somebody returning to this page wants to see. */
function ImportFlow({ orgId, role }: { orgId: string; role: OrgRole }) {
  const current = useLinkImport(orgId);
  const [switching, setSwitching] = useState(false);
  // One still uploading was cut off before its rows were all sent, and its
  // file is gone with that page: the next import replaces it.
  const job = current.data?.import;
  const live = job && job.status !== "uploading" ? job : null;

  return (
    <>
      <PageHeader
        title="Import from another service"
        sub="Your short URLs stay the same. Each link keeps its domain, its slug and where it goes."
      />
      {live ? (
        <>
          <Stepper current={switching ? "switch" : "import"} />
          <div className="mt-6">
            {switching ? (
              <SwitchStep
                orgId={orgId}
                hosts={live.hosts}
                serviceName={serviceNameOf(live.service)}
              />
            ) : (
              <JobView orgId={orgId} job={live} onNext={() => setSwitching(true)} />
            )}
          </div>
        </>
      ) : (
        !current.isPending && <Wizard orgId={orgId} role={role} />
      )}
    </>
  );
}

const serviceNameOf = (id: string | null) =>
  IMPORT_SERVICES.find((s) => s.id === id)?.name ?? "your old service";

/** From "where are your links" to sending the rows. Once they are sent the
 * server has the import, and ImportFlow shows that instead. */
function Wizard({ orgId, role }: { orgId: string; role: OrgRole }) {
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<ImportServiceId | null>(null);
  const [file, setFile] = useState<FileState | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [checked, setChecked] = useState<ImportVerdict[]>([]);
  const [room, setRoom] = useState<number | null>(null);

  const read = useMemo(() => readFile(file), [file]);
  const rows = useMemo(() => {
    const left = new Set(skipped);
    return read.rows.filter((row) => !left.has(row.host));
  }, [read.rows, skipped]);
  // Memoised: the upload starts again whenever this list changes.
  const ready = useMemo(() => {
    const lines = new Set(checked.filter((v) => v.status === "ready").map((v) => v.line));
    return rows.filter((row) => lines.has(row.line));
  }, [rows, checked]);
  const onChecked = useCallback((verdicts: ImportVerdict[], left: number | null) => {
    setChecked(verdicts);
    setRoom(left);
  }, []);

  return (
    <>
      <Stepper current={step} />
      <div className="mt-6">
        {step === "service" && (
          <ServiceStep
            value={service}
            onPick={(id) => {
              setService(id);
              setStep("file");
            }}
          />
        )}
        {step === "file" && service && (
          <FileStep
            service={service}
            file={file}
            read={read}
            onFile={setFile}
            onBack={() => setStep("service")}
            onNext={() => setStep("domains")}
          />
        )}
        {step === "domains" && (
          <DomainsStep
            orgId={orgId}
            role={role}
            hosts={hostsOf(read.rows)}
            rows={read.rows}
            serviceName={serviceNameOf(service)}
            skipped={skipped}
            onSkip={setSkipped}
            onBack={() => setStep("file")}
            onNext={() => setStep("check")}
          />
        )}
        {step === "check" && (
          <CheckStep
            orgId={orgId}
            rows={rows}
            unreadable={read.unreadable}
            onChecked={onChecked}
            checked={checked}
            room={room}
            onBack={() => setStep("domains")}
            onNext={() => setStep("import")}
          />
        )}
        {step === "import" && service && (
          <UploadStep orgId={orgId} service={service} rows={ready} />
        )}
      </div>
    </>
  );
}

function readFile(file: FileState | null): ReadResult {
  if (!file?.map) return { rows: [], unreadable: [] };
  const body = file.hasHeader ? file.table.slice(1) : file.table;
  return readRows(body, file.map, file.hasHeader ? 2 : 1);
}

/* ---------------- the steps ---------------- */

/** A real sequence, so its markers are numbers (see rdyrct-design). */
function Stepper({ current }: { current: Step }) {
  const at = STEPS.findIndex((step) => step.id === current);
  return (
    <>
      <p className="tnum text-sm sm:hidden">
        <span className="text-muted">
          Step {at + 1} of {STEPS.length}:
        </span>{" "}
        <span className="font-semibold">{STEPS[at].label}</span>
      </p>
      <ol className="hidden flex-wrap items-center gap-x-2 gap-y-2 text-sm sm:flex">
        {STEPS.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2">
            <span
              aria-current={index === at ? "step" : undefined}
              className={cn(
                "flex items-center gap-2",
                index === at ? "font-semibold text-text" : "text-muted",
              )}
            >
              <span
                className={cn(
                  "tnum flex size-6 items-center justify-center rounded-full border text-xs",
                  index < at && "border-accent bg-accent text-bg",
                  index === at && "border-accent text-accent",
                  index > at && "border-border",
                )}
              >
                {index < at ? <Check size={13} aria-label="Done" /> : index + 1}
              </span>
              {step.label}
            </span>
            {index < STEPS.length - 1 && (
              <ChevronRight size={14} className="text-border" aria-hidden />
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-balance">{title}</h2>
      {children}
    </section>
  );
}

function Nav({ onBack, next }: { onBack?: () => void; next: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      {next}
    </div>
  );
}

function ServiceStep({
  value,
  onPick,
}: {
  value: ImportServiceId | null;
  onPick: (id: ImportServiceId) => void;
}) {
  return (
    <Section title="Where are your links now?">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {IMPORT_SERVICES.map((service) => (
          <button
            key={service.id}
            type="button"
            onClick={() => onPick(service.id)}
            className={cn(
              "flex items-center justify-between rounded-lg border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent",
              value === service.id ? "border-accent" : "border-border",
            )}
          >
            <span className="font-medium">{service.name}</span>
            <ChevronRight size={16} className="text-muted" aria-hidden />
          </button>
        ))}
      </div>
    </Section>
  );
}

function FileStep({
  service,
  file,
  read,
  onFile,
  onBack,
  onNext,
}: {
  service: ImportServiceId;
  file: FileState | null;
  read: ReadResult;
  onFile: (file: FileState) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const info = IMPORT_SERVICES.find((s) => s.id === service)!;

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const table = parseCsv(await picked.text());
    if (!table.length) return toast("That file has no rows.", "error");
    onFile({ name: picked.name, table, map: detectColumns(table[0]), hasHeader: true });
  };

  return (
    <Section title={`Export your links from ${info.name}`}>
      <ol className="flex max-w-prose list-decimal flex-col gap-1.5 pl-5 text-sm text-pretty">
        {info.steps.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <label
        className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center hover:bg-surface-2 focus-within:outline-2 focus-within:outline-accent"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void choose(event.dataTransfer.files[0]);
        }}
      >
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="sr-only"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        {file ? (
          <>
            <span className="font-mono text-sm">{file.name}</span>
            <span className="tnum text-sm text-muted">
              {read.rows.length.toLocaleString()} links found. Choose another file to replace it.
            </span>
          </>
        ) : (
          <>
            <span className="font-medium">Choose the CSV file</span>
            <span className="text-sm text-muted">or drop it here</span>
          </>
        )}
      </label>
      {file && !file.map && <ColumnPicker file={file} onChange={onFile} />}
      {file?.map && file.table.length > 0 && read.rows.length === 0 && (
        <p className="text-sm text-muted">
          No row in this file has both a short URL and a destination. Check that it is the links
          export.
        </p>
      )}
      <Nav
        onBack={onBack}
        next={
          <Button variant="primary" disabled={!read.rows.length} onClick={onNext}>
            Continue
          </Button>
        }
      />
    </Section>
  );
}

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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm">We could not tell which column is which. Pick them:</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Short URL
          {pick("shortUrl")}
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Where it goes
          {pick("destination")}
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Title (optional)
          {pick("title")}
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
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

function DomainsStep({
  orgId,
  role,
  hosts,
  rows,
  serviceName,
  skipped,
  onSkip,
  onBack,
  onNext,
}: {
  orgId: string;
  role: OrgRole;
  hosts: string[];
  rows: ImportRow[];
  serviceName: string;
  skipped: string[];
  onSkip: (hosts: string[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const canManage = role === "owner" || role === "admin";
  const domains = useDomains(orgId, canManage);
  const byHost = new Map((domains.data ?? []).map((domain) => [domain.hostname, domain]));
  const left = new Set(skipped);
  // Members cannot list the org's domains, so they are not held here: the
  // check in the next step says which hosts the org lacks.
  const waiting = canManage ? hosts.filter((host) => !byHost.has(host) && !left.has(host)) : [];
  const perHost = new Map<string, number>();
  for (const row of rows) perHost.set(row.host, (perHost.get(row.host) ?? 0) + 1);
  const count = (host: string) => perHost.get(host) ?? 0;

  return (
    <Section title="The domains your links live on">
      <p className="max-w-prose text-sm text-pretty text-muted">
        Each link keeps its domain, so the domain has to be on rdyrct first. Your links keep working
        on {serviceName} until the very last step, when you switch the DNS.
      </p>
      <ul className="flex flex-col gap-3">
        {hosts.map((host) => (
          <li key={host}>
            <DomainRow
              orgId={orgId}
              host={host}
              links={count(host)}
              domain={byHost.get(host)}
              canManage={canManage}
              skipped={left.has(host)}
              onSkip={(skip) =>
                onSkip(skip ? [...skipped, host] : skipped.filter((h) => h !== host))
              }
            />
          </li>
        ))}
      </ul>
      <Nav
        onBack={onBack}
        next={
          <Button
            variant="primary"
            disabled={waiting.length > 0 || skipped.length === hosts.length}
            onClick={onNext}
          >
            Continue
          </Button>
        }
      />
    </Section>
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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-sm">{host}</span>
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
      <Button variant="primary" size="sm" disabled={adding} onClick={add}>
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
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={share}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full bg-accent transition-[width]" style={{ width: `${share}%` }} />
      </div>
      <p className="tnum text-sm text-muted">
        {label}: {done.toLocaleString()} of {total.toLocaleString()}
      </p>
    </div>
  );
}

function Totals({ items }: { items: { label: string; value: number }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-3">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="tnum text-2xl font-semibold">{item.value.toLocaleString()}</dd>
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
      <h3 className="text-sm font-semibold">Won't import</h3>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border sm:hidden">
        {shown.map((row) => (
          <li key={row.line} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
            <span className="tnum text-xs text-muted">Line {row.line}</span>
            {row.address && <span className="font-mono text-xs break-all">{row.address}</span>}
            <span className="text-pretty">{row.reason}</span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-md border border-border sm:block">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-right font-normal">Line</th>
              <th className="px-3 py-2 font-normal">Short URL</th>
              <th className="px-3 py-2 font-normal">Why</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.line} className="border-t border-border align-top">
                <td className="tnum px-3 py-2 text-right text-muted">{row.line}</td>
                <td className="px-3 py-2 font-mono text-xs break-all">{row.address}</td>
                <td className="px-3 py-2 text-pretty">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function CheckStep({
  orgId,
  rows,
  unreadable,
  checked,
  room,
  onChecked,
  onBack,
  onNext,
}: {
  orgId: string;
  rows: ImportRow[];
  unreadable: UnreadableRow[];
  checked: ImportVerdict[];
  room: number | null;
  onChecked: (verdicts: ImportVerdict[], room: number | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const toast = useToast();
  const [done, setDone] = useState(0);
  const fresh = checked.length !== rows.length;

  useEffect(() => {
    if (!fresh) return;
    let current = true;
    void sendChunks(`/orgs/${orgId}/link-import/check`, rows, (n) => current && setDone(n))
      .then((result) => current && onChecked(result.verdicts, result.room))
      .catch((error: Error) =>
        toast(error instanceof ApiError ? error.message : "Something went wrong", "error"),
      );
    return () => {
      current = false;
    };
  }, [orgId, rows, fresh, onChecked, toast]);

  if (fresh)
    return (
      <Section title="Checking your links">
        <Progress done={done} total={rows.length} label="Checked" />
        <p className="text-sm text-muted">Nothing is written yet.</p>
      </Section>
    );

  const ready = rows.filter((row) =>
    checked.some((verdict) => verdict.line === row.line && verdict.status === "ready"),
  );
  const exists = checked.filter((verdict) => verdict.status === "exists").length;
  const problems = problemsOf(rows, checked, unreadable);
  const fits = room === null ? ready.length : Math.min(room, ready.length);

  return (
    <Section title="Here's what will happen">
      <Totals
        items={[
          { label: "Will import", value: fits },
          { label: "Already on rdyrct", value: exists },
          { label: "Won't import", value: problems.length + (ready.length - fits) },
        ]}
      />
      {fits < ready.length && (
        <p className="max-w-prose text-sm text-pretty">
          Your plan has room for {fits.toLocaleString()} more links, so the last{" "}
          {(ready.length - fits).toLocaleString()} in the file will be left out.{" "}
          <Link to="/billing" className="text-accent hover:underline">
            See plans
          </Link>
        </p>
      )}
      <p className="max-w-prose text-sm text-pretty text-muted">
        Clicks start counting from zero here. Your old service keeps the history.
      </p>
      {ready.length > 0 && <Sample rows={ready.slice(0, 5)} total={ready.length} />}
      <Problems rows={problems} />
      <Nav
        onBack={onBack}
        next={
          <Button variant="primary" disabled={!fits} onClick={onNext}>
            Import {fits.toLocaleString()} {fits === 1 ? "link" : "links"}
          </Button>
        }
      />
    </Section>
  );
}

/** A few ready rows as they will be stored: the short URL, where it goes,
 * and the UTM tags split out, the way the link editor will show them. */
function Sample({ rows, total }: { rows: ImportRow[]; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {total > rows.length ? `The first ${rows.length}` : "The links"}
      </h3>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border sm:hidden">
        {rows.map((row) => (
          <li key={row.line} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
            <span className="font-mono text-xs break-all">{shortOf(row)}</span>
            <span className="break-all">{stripUtmParams(row.destination)}</span>
            <span className="text-muted">{utmTags(row).join(", ") || "No UTM tags"}</span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-md border border-border sm:block">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-normal">Short URL</th>
              <th className="px-3 py-2 font-normal">Goes to</th>
              <th className="px-3 py-2 font-normal">UTM tags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tags = utmTags(row);
              return (
                <tr key={row.line} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-mono text-xs break-all">{shortOf(row)}</td>
                  <td className="max-w-72 truncate px-3 py-2" title={row.destination}>
                    {stripUtmParams(row.destination)}
                  </td>
                  <td className="px-3 py-2 text-muted">{tags.join(", ") || "None"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A row's UTM tags as the editor will show them: "source: instagram". */
function utmTags(row: ImportRow): string[] {
  const utm = resolveUtm(row.destination, {});
  return UTM_KEYS.filter(([, field]) => utm[field]).map(
    ([param, field]) => `${param.slice(4)}: ${utm[field]}`,
  );
}

/** Sends the rows to the server and starts the import. Only this part needs
 * the page: once it is started, JobView takes over from what the server
 * reports. */
function UploadStep({
  orgId,
  service,
  rows,
}: {
  orgId: string;
  service: ImportServiceId;
  rows: ImportRow[];
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Each attempt creates an import, so it must run once, not once per effect
  // run (StrictMode runs effects twice).
  const sent = useRef(-1);

  useEffect(() => {
    if (sent.current === attempt) return;
    sent.current = attempt;
    setFailed(false);
    setDone(0);
    void upload(orgId, service, rows, setDone)
      .then(() => qc.invalidateQueries({ queryKey: ["link-import", orgId] }))
      .catch((error: Error) => {
        setFailed(true);
        toast(error instanceof ApiError ? error.message : "Something went wrong", "error");
      });
  }, [orgId, service, rows, attempt, qc, toast]);

  return (
    <Section title="Sending your links">
      <Progress done={done} total={rows.length} label="Sent" />
      <p className="max-w-prose text-sm text-pretty text-muted">
        Keep this page open until they are all sent. The import then carries on without it.
      </p>
      {failed && (
        <Nav
          next={
            <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        />
      )}
    </Section>
  );
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
  onNext: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"retry" | "new" | null>(null);

  useEffect(() => {
    if (job.status === "done") void qc.invalidateQueries({ queryKey: ["links", orgId] });
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
        They answer as soon as their domain points at rdyrct, which is the next step.
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
            <Button variant="primary" disabled={!!busy} onClick={onNext}>
              Next: switch the DNS
            </Button>
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
        Your links are on rdyrct and wait for their domain. Until you change the DNS, people still
        reach them through {serviceName}.
      </p>
      <ul className="flex flex-col gap-3">
        {hosts.map((host) => {
          const domain = byHost.get(host);
          if (!domain) return null;
          const ready = domain.status === "active";
          return (
            <li
              key={host}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-sm">{host}</span>
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
                  <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
                    <code className="font-mono text-xs">
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
