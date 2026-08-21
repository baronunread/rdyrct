import { useState } from "react";
import {
  ChartColumn,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Link,
  Pencil,
  QrCode,
  Trash2,
} from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation } from "motion/react";
import { shortUrl } from "../lib/api";
import { type LinkDTO, type Sort } from "@/shared/types";
import { Slug, Table, Th, Td } from "../ui/misc";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { SortTh } from "../ui/sort-th";
import { shortDate } from "../lib/dates";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { cn } from "../ui/cn";
import { AliasThread } from "./alias-thread";
import { useConfig } from "../lib/hooks";
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
  onDelete: (link: LinkDTO) => void;
  onCreateAlias: (link: LinkDTO) => void;
}

/** The short link itself: expander, domain badge, slug, copy button. */
function LinkCell({
  link,
  appHost,
  isExpanded,
  onToggle,
  navigate,
}: {
  link: LinkDTO;
  appHost: string;
  isExpanded: boolean;
  onToggle: (() => void) | null;
  navigate: (to: string) => void;
}) {
  const toast = useToast();
  const hidden = link.addressCount - 1;
  return (
    <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${isExpanded ? "Hide" : "Show"} ${hidden} alias${hidden === 1 ? "" : "es"}`}
          aria-expanded={isExpanded}
          className="flex shrink-0 cursor-pointer items-center justify-center p-1 text-muted transition-transform duration-150 active:scale-[0.96] hover:text-text"
        >
          <ChevronRight
            size={14}
            className={cn("transition-transform", isExpanded && "rotate-90")}
          />
        </button>
      ) : (
        <span className="w-5.5 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => navigate(linkDetailPath(link))}
        className="group flex min-w-0 max-w-full cursor-pointer flex-col items-start gap-0.5 text-start"
      >
        {/* The domain is half the address, so it reads as the address: mono,
            quiet, directly above the slug it belongs to. It used to sit in a
            Badge, which is for state (active, pending, blocked) rather than
            for an identifier. */}
        <span className="min-w-0 max-w-full truncate font-mono text-2xs text-muted">
          {link.domain || appHost}
        </span>
        <Slug slug={link.slug} className="font-bold text-accent group-hover:underline" />
      </button>
      <span className="shrink-0">
        <CopyButton
          text={shortUrl(link.slug, link.domain)}
          label={`Copy ${shortUrl(link.slug, link.domain)}`}
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </span>
    </div>
  );
}

function RowMenu({ link, actions }: { link: LinkDTO; actions: RowActions }) {
  const { navigate, onQrClick, onEdit, onDelete, onCreateAlias } = actions;
  return (
    <Menu
      align="end"
      label={`Actions for ${link.slug}`}
      trigger={
        <div className="flex justify-end">
          <span className="rounded p-1.5 text-muted transition-transform duration-150 active:scale-[0.96] hover:bg-surface-2 hover:text-text">
            <Ellipsis size={15} />
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
    </Menu>
  );
}

function LinkRow({
  orgId,
  link,
  appHost,
  isExpanded,
  onToggle,
  actions,
}: {
  orgId: string;
  link: LinkDTO;
  appHost: string;
  isExpanded: boolean;
  onToggle: (() => void) | null;
  actions: RowActions;
}) {
  return (
    <>
      <tr className="group">
        <Td>
          <LinkCell
            link={link}
            appHost={appHost}
            isExpanded={isExpanded}
            onToggle={onToggle}
            navigate={actions.navigate}
          />
        </Td>
        <Td className="hidden truncate text-xs text-muted lg:table-cell">
          {link.title || <span className="text-muted">—</span>}
        </Td>
        <Td className="hidden max-w-64 xl:table-cell">
          <a
            href={link.destination}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-muted hover:text-accent"
          >
            {/* A destination is a URL somebody pastes and checks character by
                character, so it keeps the mono face the title beside it does
                not. */}
            <span className="truncate font-mono text-xs">{link.destination}</span>
            <ExternalLink size={12} className="shrink-0" />
          </a>
        </Td>
        <Td className="tnum text-end">{link.clicks}</Td>
        <Td className="hidden text-xs whitespace-nowrap text-muted sm:table-cell">
          {shortDate(link.createdAt)}
        </Td>
        <Td>
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
  const config = useConfig();
  const appHost = config.data?.appHost ?? window.location.host;
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
            <sm   50%      + 9rem   (short link, clicks, actions)
            sm    40%      + 16rem  (+ created)
            lg    30 + 16% + 16rem  (+ title)
            xl    26 + 16 + 22% + 16rem  (+ destination)
          Percentages share the row with 16rem of fixed columns, so they cannot
          add up to 100. */}
      <Table fixed>
        <thead>
          <tr>
            <SortTh
              label="Short link"
              sortKey="slug"
              sort={sort}
              onSort={onSort}
              className="w-1/2 sm:w-2/5 lg:w-[30%] xl:w-[26%]"
            />
            <Th className="hidden lg:table-cell lg:w-[16%]">Title</Th>
            <Th className="hidden xl:table-cell xl:w-[22%]">Destination</Th>
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
            <Th className="w-16 text-end whitespace-nowrap">Actions</Th>
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
                appHost={appHost}
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
