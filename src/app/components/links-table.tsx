import { useState } from "react";
import { ChartColumn, ChevronRight, Ellipsis, Link, Pencil, QrCode, Trash2 } from "@/app/ui/icons";
import { AnimatePresence, LazyMotion, domAnimation } from "motion/react";
import { type LinkDTO, type Sort } from "@/shared/types";
import { Badge, Table, Th, Td } from "../ui/misc";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { SortTh } from "../ui/sort-th";
import { shortDate } from "../lib/dates";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { cn } from "../ui/cn";
import { AliasThread } from "./alias-thread";
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

/** The link in two lines (rdyrct-design, "Tables earn two lines"): its
 * title in bold over the short address in mono, the domain quiet and the
 * slug in ink. An untitled link puts the address on the first line alone. */
function LinkCell({
  link,
  isExpanded,
  onToggle,
  navigate,
}: {
  link: LinkDTO;
  isExpanded: boolean;
  onToggle: (() => void) | null;
  navigate: (to: string) => void;
}) {
  const toast = useToast();
  const hidden = link.addressCount - 1;
  const host = new URL(link.url).host;
  const address = (
    <span className="min-w-0 max-w-full truncate font-mono text-xs">
      <span className="text-muted">{host}/</span>
      {link.slug}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${isExpanded ? "Hide" : "Show"} ${hidden} alias${hidden === 1 ? "" : "es"}`}
          aria-expanded={isExpanded}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-[scale,background-color,color] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text"
        >
          <ChevronRight
            size={14}
            className={cn("transition-transform", isExpanded && "rotate-90")}
          />
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => navigate(linkDetailPath(link))}
        className="flex min-w-0 max-w-full cursor-pointer flex-col items-start gap-0.5 text-start"
      >
        {link.title ? (
          <>
            <span className="max-w-full truncate text-sm font-semibold [@media(hover:hover)]:group-hover:underline">
              {link.title}
            </span>
            {address}
          </>
        ) : (
          <span className="[@media(hover:hover)]:group-hover:underline">{address}</span>
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
      <span className="shrink-0 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
        <CopyButton
          text={link.url}
          label={`Copy ${link.url}`}
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </span>
    </div>
  );
}

/** Where the link goes: the host over the rest, so a column of them scans by
 * site first. */
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
      className="flex min-w-0 flex-col gap-0.5 [@media(hover:hover)]:hover:text-accent"
    >
      <span className="truncate text-sm">{host}</span>
      {rest && <span className="truncate font-mono text-xs text-muted">{rest}</span>}
    </a>
  );
}

function RowMenu({ link, actions }: { link: LinkDTO; actions: RowActions }) {
  const { navigate, onQrClick, onEdit, onDelete, onCreateAlias, canWrite } = actions;
  return (
    <Menu
      align="end"
      label={`Actions for ${link.slug}`}
      trigger={
        <div className="flex justify-end">
          <span className="grid size-8 place-items-center rounded-md text-muted transition-[scale,background-color,color] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text">
            <Ellipsis size={16} />
          </span>
        </div>
      }
    >
      <MenuItem onClick={() => navigate(linkDetailPath(link))}>
        <ChartColumn size={14} /> View analytics
      </MenuItem>
      <MenuItem onClick={() => onQrClick(link)}>
        <QrCode size={14} /> QR code
      </MenuItem>
      {canWrite && (
        <>
          <MenuItem onClick={() => onEdit(link)}>
            <Pencil size={14} /> Edit
          </MenuItem>
          <MenuItem onClick={() => onCreateAlias(link)}>
            <Link size={14} /> Create alias
          </MenuItem>
          <MenuSeparator />
          <MenuItem className="text-danger" onClick={() => onDelete(link)}>
            <Trash2 size={14} /> Delete
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function LinkRow({
  orgId,
  link,
  isExpanded,
  onToggle,
  actions,
}: {
  orgId: string;
  link: LinkDTO;
  isExpanded: boolean;
  onToggle: (() => void) | null;
  actions: RowActions;
}) {
  return (
    <>
      <tr className="group">
        <Td className="py-2.5">
          <LinkCell
            link={link}
            isExpanded={isExpanded}
            onToggle={onToggle}
            navigate={actions.navigate}
          />
        </Td>
        <Td className="hidden py-2.5 lg:table-cell">
          <DestinationCell destination={link.destination} />
        </Td>
        <Td className="tnum py-2.5 text-end font-semibold">
          {link.clicks.toLocaleString("en-US")}
        </Td>
        <Td className="hidden py-2.5 text-xs whitespace-nowrap text-muted sm:table-cell">
          {shortDate(link.createdAt)}
        </Td>
        <Td className="py-2.5">
          <RowMenu link={link} actions={actions} />
        </Td>
      </tr>
      <AnimatePresence>
        {isExpanded && <AliasThread key="alias-thread" orgId={orgId} link={link} />}
      </AnimatePresence>
    </>
  );
}

export function LinksTable({
  orgId,
  paged,
  sort,
  onSort,
  page,
  hasNext,
  onNext,
  onBack,
  ...actions
}: RowActions & {
  orgId: string;
  paged: LinkDTO[];
  sort: Sort;
  onSort: (s: Sort) => void;
  page: number;
  hasNext: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <LazyMotion features={domAnimation}>
      {/* Load-bearing widths: the table is `fixed`, so these decide the layout
          rather than describing it, and columns drop in as the screen grows.
            <sm   link + clicks + actions
            sm    + created
            lg    + destination
          The link column takes what is left. */}
      <Table fixed>
        <thead>
          <tr>
            <SortTh label="Link" sortKey="slug" sort={sort} onSort={onSort} />
            {/* fallow-ignore-next-line css-token-drift */}
            <Th className="hidden lg:table-cell lg:w-[34%]">Destination</Th>
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
              className="hidden sm:table-cell sm:w-28"
            />
            <Th className="w-12">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {paged.map((link) => {
            const hasAliases = link.addressCount > 1;
            return (
              <LinkRow
                key={link.id}
                orgId={orgId}
                link={link}
                isExpanded={hasAliases && expanded.has(link.id)}
                onToggle={hasAliases ? () => toggleExpanded(link.id) : null}
                actions={actions}
              />
            );
          })}
        </tbody>
      </Table>
      <CursorPager page={page} hasNext={hasNext} onBack={onBack} onNext={onNext} />
    </LazyMotion>
  );
}
