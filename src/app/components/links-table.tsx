import { useEffect, useRef, useState } from "react";
import {
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconDots,
  IconLinkPlus,
  IconMinus,
  IconPencil,
  IconQrcode,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, LazyMotion, domAnimation } from "motion/react";
import { type LinkDTO, type Sort } from "@/shared/types";
import { Badge, Th, Td } from "../ui/misc";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { SortTh } from "../ui/sort-th";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { hasQrOverride, tableDate, trendNote, type LinkRow } from "../lib/links-data";
import { cn } from "../ui/cn";
import { AliasThread } from "./alias-thread";
import { ShortAddress } from "./short-address";
import { QrThumb, SiteLetter, Sparkline } from "./link-marks";
import { CursorPager } from "../ui/pagination";

function linkDetailPath(link: LinkDTO): string {
  return link.domain
    ? `/links/${link.slug}?domain=${encodeURIComponent(link.domain)}`
    : `/links/${link.slug}`;
}

/** What a row can do to its link. The table threads these straight through. */
interface RowActions {
  navigate: (to: string) => void;
  onQrClick: (link: LinkDTO) => void;
  onEdit: (link: LinkDTO) => void;
  /** False for a viewer, who may read every one of these rows and change
   * none of them (#157). The analytics and QR entries stay: both are reads. */
  canWrite: boolean;
  onDelete: (link: LinkDTO) => void;
  onCreateAlias: (link: LinkDTO) => void;
}

/** Which optional columns this page draws. The sparkline only appears once
 * the API sends a series: a column of blanks would say nothing. */
export interface TableColumns {
  spark: boolean;
}

/**
 * A 16px box, ticked in the accent. Native underneath (so Space, labels and
 * screen readers work as they always do), drawn over by the tick, inside a
 * 40px target so it is easy to hit without being big.
 */
function RowCheck({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const on = checked || indeterminate;
  return (
    <label className="relative -my-2 grid size-10 cursor-pointer place-items-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className={cn(
          "peer size-4 cursor-pointer appearance-none rounded-[5px] transition-[background-color,box-shadow] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          on ? "bg-accent" : "bg-surface smooth-shadow-ring-xs",
        )}
      />
      {on && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center text-bg"
        >
          {indeterminate ? <IconMinus size={12} stroke={3} /> : <IconCheck size={12} stroke={3} />}
        </span>
      )}
    </label>
  );
}

/** The link in two lines (rdyrct-design, "Tables earn two lines"): the QR
 * thumbnail, then its title in bold over the short address in mono. An
 * untitled link puts the address on the first line alone. */
function LinkCell({
  link,
  isExpanded,
  onToggle,
  onQrClick,
  navigate,
}: {
  link: LinkRow;
  isExpanded: boolean;
  onToggle: (() => void) | null;
  onQrClick: (link: LinkDTO) => void;
  navigate: (to: string) => void;
}) {
  const aliases = link.addressCount - 1;
  const custom = link.qrCustom ?? hasQrOverride(link);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        type="button"
        onClick={() => onQrClick(link)}
        aria-label={`QR code for ${link.slug}`}
        className="shrink-0 cursor-pointer rounded-md transition-[scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <QrThumb url={link.url} custom={custom} />
      </button>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(linkDetailPath(link))}
            className="min-w-0 cursor-pointer truncate text-start text-sm font-semibold [@media(hover:hover)]:hover:underline"
          >
            {link.title || (
              <ShortAddress url={link.url} slug={link.slug} className="text-sm font-normal" />
            )}
          </button>
          {link.suspendedAt && (
            <span
              className="shrink-0"
              title="Paused. It does not redirect until we have looked at it. If this is a mistake, write to support and we will restore it."
            >
              <Badge color="pink">paused</Badge>
            </span>
          )}
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-label={`${isExpanded ? "Hide" : "Show"} ${aliases} alias${aliases === 1 ? "" : "es"}`}
              aria-expanded={isExpanded}
              className="-my-1 inline-flex h-6 shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-xs text-muted transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text"
            >
              <span className="tnum">+{aliases}</span>
              <IconChevronRight
                size={12}
                aria-hidden
                className={cn("transition-transform duration-150", isExpanded && "rotate-90")}
              />
            </button>
          )}
        </span>
        {link.title && <ShortAddress url={link.url} slug={link.slug} />}
      </div>
    </div>
  );
}

/** Where the link goes: a letter tile for the site, the host over the rest,
 * so a column of them scans by site first. */
function DestinationCell({ destination }: { destination: string }) {
  let host = destination;
  let rest = "";
  try {
    const url = new URL(destination);
    host = url.host;
    rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  } catch {
    // Stored destinations are absolute URLs; show anything else as it is.
  }
  return (
    <a
      href={destination}
      target="_blank"
      rel="noreferrer"
      title={destination}
      className="flex min-w-0 items-center gap-2.5 [@media(hover:hover)]:hover:text-accent"
    >
      <SiteLetter host={host} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm">{host.replace(/^www\./, "")}</span>
        {rest && <span className="truncate font-mono text-[11.5px] text-placeholder">{rest}</span>}
      </span>
    </a>
  );
}

function TrendCell({ link }: { link: LinkRow }) {
  const note = trendNote(link);
  return (
    <div className="flex flex-col items-end gap-0.5">
      {link.spark && <Sparkline series={link.spark} />}
      {note && (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
            note.tone === "bad" ? "text-danger" : "text-butter",
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {note.text}
        </span>
      )}
    </div>
  );
}

const ROW_ICON =
  "grid size-8 place-items-center rounded-md text-muted transition-[scale,background-color,color] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text";

function RowMenu({ link, actions }: { link: LinkDTO; actions: RowActions }) {
  const { navigate, onQrClick, onEdit, onDelete, onCreateAlias, canWrite } = actions;
  return (
    <Menu
      align="end"
      label={`Actions for ${link.slug}`}
      trigger={
        <span className={ROW_ICON}>
          <IconDots size={16} aria-hidden />
        </span>
      }
    >
      <MenuItem onClick={() => navigate(linkDetailPath(link))}>
        <IconChartBar size={14} aria-hidden /> Analytics
      </MenuItem>
      <MenuItem onClick={() => onQrClick(link)}>
        <IconQrcode size={14} aria-hidden /> QR code
      </MenuItem>
      {canWrite && (
        <>
          <MenuItem onClick={() => onEdit(link)}>
            <IconPencil size={14} aria-hidden /> Edit
          </MenuItem>
          <MenuItem onClick={() => onCreateAlias(link)}>
            <IconLinkPlus size={14} aria-hidden /> Add another short link
          </MenuItem>
          <MenuSeparator />
          <MenuItem className="text-danger" onClick={() => onDelete(link)}>
            <IconTrash size={14} aria-hidden /> Delete link
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

/** Copy and the menu. Shown on hover or focus where there is hover, always
 * on a touch screen, where nothing hovers. */
function RowActionsCell({ link, actions }: { link: LinkDTO; actions: RowActions }) {
  const toast = useToast();
  return (
    <div className="flex items-center justify-end gap-0.5">
      <span className="max-sm:hidden [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        <CopyButton
          text={link.url}
          label={`Copy ${link.url}`}
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </span>
      <span className="w-8 [@media(hover:hover)]:sm:opacity-0 [@media(hover:hover)]:sm:group-hover:opacity-100 [@media(hover:hover)]:sm:group-focus-within:opacity-100 [@media(hover:hover)]:sm:has-[[aria-expanded=true]]:opacity-100">
        <RowMenu link={link} actions={actions} />
      </span>
    </div>
  );
}

function LinkRowView({
  orgId,
  link,
  columns,
  selected,
  onSelect,
  isExpanded,
  onToggle,
  creator,
  actions,
}: {
  orgId: string;
  link: LinkRow;
  columns: TableColumns;
  selected: boolean;
  onSelect: () => void;
  isExpanded: boolean;
  onToggle: (() => void) | null;
  creator: string | undefined;
  actions: RowActions;
}) {
  return (
    <>
      <tr className={cn("group", selected && "bg-accent/[0.06]")}>
        <Td className="hidden w-10 py-2.5 pr-0 pl-2 sm:table-cell">
          <RowCheck checked={selected} onChange={onSelect} label={`Select ${link.slug}`} />
        </Td>
        <Td className="py-3 max-sm:pl-3">
          <LinkCell
            link={link}
            isExpanded={isExpanded}
            onToggle={onToggle}
            onQrClick={actions.onQrClick}
            navigate={actions.navigate}
          />
        </Td>
        <Td className="hidden py-3 lg:table-cell">
          <DestinationCell destination={link.destination} />
        </Td>
        {columns.spark && (
          <Td className="hidden py-2 xl:table-cell">
            <TrendCell link={link} />
          </Td>
        )}
        <Td className="tnum py-3 text-end text-[15px] font-semibold max-sm:w-16">
          {link.clicks.toLocaleString("en-US")}
        </Td>
        <Td className="hidden py-3 sm:table-cell">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="tnum text-sm whitespace-nowrap">{tableDate(link.createdAt)}</span>
            {creator && <span className="truncate text-xs text-placeholder">{creator}</span>}
          </span>
        </Td>
        <Td className="py-3 pr-2 pl-0 max-sm:w-11">
          <RowActionsCell link={link} actions={actions} />
        </Td>
      </tr>
      <AnimatePresence>
        {isExpanded && (
          <AliasThread key="alias-thread" orgId={orgId} link={link} spark={columns.spark} />
        )}
      </AnimatePresence>
    </>
  );
}

export function LinksTable({
  orgId,
  rows,
  columns,
  sort,
  onSort,
  selection,
  onSelectionChange,
  creators,
  paging,
  ...actions
}: RowActions & {
  orgId: string;
  rows: LinkRow[];
  columns: TableColumns;
  sort: Sort;
  onSort: (s: Sort) => void;
  /** Ids of the ticked rows on this page. */
  selection: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  /** Member names by user id, for the line under Created. */
  creators: Map<string, string>;
  paging: {
    page: number;
    pageSize: number;
    total?: number;
    hasNext: boolean;
    onNext: () => void;
    onBack: () => void;
  };
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ticked = rows.filter((row) => selection.has(row.id)).length;
  const all = rows.length > 0 && ticked === rows.length;
  const toggleOne = (id: string) => {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  return (
    <LazyMotion features={domAnimation}>
      <div className="overflow-hidden rounded-xl bg-surface smooth-shadow-ring-xs">
        <div className="overflow-x-auto overscroll-x-none">
          {/* Load-bearing widths: the table is `fixed`, so these decide the
              layout rather than describing it, and columns drop in as the
              screen grows.
                <sm   link + clicks + actions
                sm    + checkbox + created
                lg    + destination
                xl    + last 14 days (when the API sends it)
              The link column takes what is left. */}
          <table className="w-full table-fixed text-sm [&_tbody_tr]:transition-colors [@media(hover:hover)]:[&_tbody_tr]:hover:bg-surface-2/40">
            {/* No header on a phone: two columns explain themselves, and the
                rows start at the top of the card as the mock draws them. */}
            <thead className="max-sm:hidden">
              <tr>
                <Th className="hidden w-10 py-1.5 pr-0 pl-2 sm:table-cell">
                  <RowCheck
                    checked={all}
                    indeterminate={ticked > 0 && !all}
                    onChange={() =>
                      onSelectionChange(all ? new Set() : new Set(rows.map((row) => row.id)))
                    }
                    label={all ? "Clear selection" : "Select every link on this page"}
                  />
                </Th>
                <SortTh
                  label="Link"
                  sortKey="slug"
                  sort={sort}
                  onSort={onSort}
                  className="max-sm:pl-3"
                />
                {/* fallow-ignore-next-line css-token-drift */}
                <Th className="hidden lg:table-cell lg:w-[30%]">Destination</Th>
                {columns.spark && (
                  <Th className="hidden w-32 text-end xl:table-cell">Last 14 days</Th>
                )}
                <SortTh
                  label="Clicks"
                  sortKey="clicks"
                  sort={sort}
                  onSort={onSort}
                  className="w-20 text-end"
                />
                <SortTh
                  label="Created"
                  sortKey="createdAt"
                  sort={sort}
                  onSort={onSort}
                  className="hidden sm:table-cell sm:w-32"
                />
                <Th className="w-12 pr-2 pl-0 sm:w-20">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((link) => {
                const hasAliases = link.addressCount > 1;
                return (
                  <LinkRowView
                    key={link.id}
                    orgId={orgId}
                    link={link}
                    columns={columns}
                    selected={selection.has(link.id)}
                    onSelect={() => toggleOne(link.id)}
                    isExpanded={hasAliases && expanded.has(link.id)}
                    onToggle={hasAliases ? () => toggleExpanded(link.id) : null}
                    creator={link.createdBy ? creators.get(link.createdBy) : undefined}
                    actions={actions}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <CursorPager
          page={paging.page}
          pageSize={paging.pageSize}
          rows={rows.length}
          total={paging.total}
          hasNext={paging.hasNext}
          onBack={paging.onBack}
          onNext={paging.onNext}
        />
      </div>
    </LazyMotion>
  );
}
