import { ExternalLink, Lock, Pencil, QrCode, Trash2 } from "lucide-react";
import { shortUrl } from "../lib/api";
import { type LinkDTO, type Sort } from "@/shared/types";
import { IconButton } from "../ui/button";
import { Table, Th, Td } from "../ui/misc";
import { SortTh } from "../ui/sort-th";
import { shortDate } from "../lib/dates";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";

export function LinksTable({
  paged,
  navigate,
  limits,
  onQrClick,
  onEdit,
  onDelete,
  sort,
  onSort,
  totalPages,
  currentPage,
  onPageChange,
  noQrToast,
}: {
  paged: LinkDTO[];
  navigate: (to: string) => void;
  limits: { qr: boolean };
  onQrClick: (link: LinkDTO) => void;
  onEdit: (link: LinkDTO) => void;
  onDelete: (link: LinkDTO) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  totalPages: number;
  currentPage: number;
  onPageChange: (fn: (p: number) => number) => void;
  noQrToast: () => void;
}) {
  const toast = useToast();

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch (error) {
      toast("Could not copy to clipboard", "error");
      throw error;
    }
  };

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
              className="w-[40%]"
            />
            <Th className="w-[25%]">Destination</Th>
            <SortTh
              label="Clicks"
              sortKey="clicks"
              sort={sort}
              onSort={onSort}
              className="w-20 text-right"
            />
            <SortTh
              label="Created"
              sortKey="createdAt"
              sort={sort}
              onSort={onSort}
              className="w-28"
            />
            <Th className="w-14 text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {paged.map((link) => (
            <tr key={link.id} className="group">
              <Td>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        link.domain
                          ? `/links/${link.slug}?domain=${encodeURIComponent(link.domain)}`
                          : `/links/${link.slug}`,
                      )
                    }
                    className="cursor-pointer font-bold text-accent hover:underline"
                  >
                    {link.domain ? `${link.domain}/${link.slug}` : `/${link.slug}`}
                  </button>
                  <CopyButton
                    text={shortUrl(link.slug, link.domain)}
                    label={`Copy ${shortUrl(link.slug, link.domain)}`}
                    onCopy={copy}
                  />
                </div>
                {link.title && <p className="text-xs text-muted">{link.title}</p>}
              </Td>
              <Td className="max-w-64">
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
              <Td className="tnum text-right">{link.clicks}</Td>
              <Td className="text-xs whitespace-nowrap text-muted">{shortDate(link.createdAt)}</Td>
              <Td>
                <div className="flex justify-end gap-0.5">
                  {limits.qr ? (
                    <IconButton label="QR code" onClick={() => onQrClick(link)}>
                      <QrCode size={15} />
                    </IconButton>
                  ) : (
                    <IconButton label="QR codes are a paid feature" onClick={noQrToast}>
                      <Lock size={15} />
                    </IconButton>
                  )}
                  <IconButton label="Edit" onClick={() => onEdit(link)}>
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton label="Delete" danger onClick={() => onDelete(link)}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted hover:text-text disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-muted tnum">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
            className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted hover:text-text disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
