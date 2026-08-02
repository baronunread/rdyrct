import { Fragment, useState } from "react";
import {
  ChartColumn,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Link,
  Lock,
  Pencil,
  QrCode,
  Trash2,
} from "lucide-react";
import { shortUrl } from "../lib/api";
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
import { Pager } from "../ui/pagination";

function linkDetailPath(link: LinkDTO): string {
  return link.domain
    ? `/links/${link.slug}?domain=${encodeURIComponent(link.domain)}`
    : `/links/${link.slug}`;
}

export function LinksTable({
  orgId,
  paged,
  navigate,
  limits,
  onQrClick,
  onEdit,
  onDelete,
  onCreateAlias,
  sort,
  onSort,
  totalPages,
  currentPage,
  onPageChange,
  noQrToast,
}: {
  orgId: string;
  paged: LinkDTO[];
  navigate: (to: string) => void;
  limits: { qr: boolean };
  onQrClick: (link: LinkDTO) => void;
  onEdit: (link: LinkDTO) => void;
  onDelete: (link: LinkDTO) => void;
  onCreateAlias: (link: LinkDTO) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  totalPages: number;
  currentPage: number;
  onPageChange: (fn: (p: number) => number) => void;
  noQrToast: () => void;
}) {
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <Table fixed>
        <thead>
          <tr>
            <SortTh
              label="Short link"
              sortKey="slug"
              sort={sort}
              onSort={onSort}
              className="w-1/2 sm:w-[40%]"
            />
            <Th className="hidden sm:table-cell sm:w-[25%]">Destination</Th>
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
            const isExpanded = hasAliases && expanded.has(link.id);
            return (
              <Fragment key={link.id}>
                <tr className="group">
                  <Td>
                    <div className="flex min-w-0 items-center gap-2.5">
                      {hasAliases ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(link.id)}
                          aria-label={
                            isExpanded
                              ? `Hide ${link.addressCount - 1} alias${link.addressCount - 1 === 1 ? "" : "es"}`
                              : `Show ${link.addressCount - 1} alias${link.addressCount - 1 === 1 ? "" : "es"}`
                          }
                          title={`${link.addressCount - 1} alias${link.addressCount - 1 === 1 ? "" : "es"}`}
                          aria-expanded={isExpanded}
                          className="flex shrink-0 cursor-pointer items-center justify-center p-1 text-muted hover:text-text"
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
                        title={link.domain ? `${link.domain}/${link.slug}` : `/${link.slug}`}
                        className="min-w-0 truncate cursor-pointer font-bold text-accent hover:underline"
                      >
                        {link.domain ? `${link.domain}/${link.slug}` : `/${link.slug}`}
                      </button>
                      <span className="shrink-0">
                        <CopyButton
                          text={shortUrl(link.slug, link.domain)}
                          label={`Copy ${shortUrl(link.slug, link.domain)}`}
                          onCopy={(text) => copyToClipboard(text, toast)}
                        />
                      </span>
                      {hasAliases && (
                        <span className="shrink-0">
                          <Badge color="accent">
                            {link.addressCount - 1} alias{link.addressCount - 1 === 1 ? "" : "es"}
                          </Badge>
                        </span>
                      )}
                    </div>
                    {link.title && <p className="truncate text-xs text-muted">{link.title}</p>}
                  </Td>
                  <Td className="hidden max-w-64 sm:table-cell">
                    <a
                      href={link.destination}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-muted hover:text-accent"
                    >
                      <span className="truncate">{link.destination}</span>
                      <ExternalLink size={12} className="shrink-0" />
                    </a>
                  </Td>
                  <Td className="tnum text-end">{link.clicks}</Td>
                  <Td className="hidden text-xs whitespace-nowrap text-muted sm:table-cell">
                    {shortDate(link.createdAt)}
                  </Td>
                  <Td>
                    <Menu
                      align="end"
                      label={`Actions for ${link.slug}`}
                      trigger={
                        <div className="flex justify-end">
                          <span className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                            <Ellipsis size={15} />
                          </span>
                        </div>
                      }
                    >
                      <MenuItem onClick={() => navigate(linkDetailPath(link))}>
                        <ChartColumn size={14} /> View analytics
                      </MenuItem>
                      <MenuItem onClick={() => (limits.qr ? onQrClick(link) : noQrToast())}>
                        {limits.qr ? <QrCode size={14} /> : <Lock size={14} />} QR code
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
                  </Td>
                </tr>
                {isExpanded && <AliasThread orgId={orgId} link={link} />}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
      <Pager page={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
    </>
  );
}
