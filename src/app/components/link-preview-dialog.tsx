import { Dialog } from "../ui/dialog";
import { CopyButton } from "../ui/copy-button";
import { Skeleton, SkeletonStatus } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { shortUrl } from "../lib/api";
import { resolveQrLook, type OrgQr } from "../lib/org-qr";
import { QRPreview } from "./qr";
import type { LinkDTO } from "@/shared/types";

function LinkPreviewContent({ link, orgQr }: { link: LinkDTO; orgQr: OrgQr }) {
  const toast = useToast();
  const url = shortUrl(link.slug, link.domain);
  return (
    <div className="flex flex-col items-center gap-3">
      <QRPreview url={url} {...resolveQrLook(link, orgQr)} downloadName={`qr-${link.slug}`} />
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <p className="min-w-0 truncate font-mono text-sm font-bold">{url}</p>
        <CopyButton
          text={url}
          label={`Copy ${url}`}
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </div>
    </div>
  );
}

/** Mirrors LinkPreviewContent block for block, at the same sizes, so the
 * dialog does not resize when the link arrives: the 208px QR box, the two
 * download buttons (h-8), then the short-URL line and its copy button. */
function LinkPreviewLoading() {
  return (
    <SkeletonStatus label="Creating your link…" className="flex flex-col items-center gap-3">
      <Skeleton className="h-52 w-52 rounded-lg" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-[4.5rem]" />
        <Skeleton className="h-8 w-[4.5rem]" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-6 w-6" />
      </div>
    </SkeletonStatus>
  );
}

/** The short URL and its QR code for one link, in a dialog: shared by "link
 * just created" (dashboard quick-create) and "show QR" (links table row
 * action). Same content, different title.
 *
 * `loading` opens the dialog before the link exists, showing a placeholder
 * the exact size of the filled content, so the palette's quick-create has
 * something on screen between the click and the created link.
 *
 * The QR is here on every plan. Only its look (logo, colors, shapes) is
 * paid, and `orgQr` already resolves to the built-in defaults for a free
 * org, which cannot have set any. */
export function LinkPreviewDialog({
  title,
  link,
  orgQr,
  onClose,
  loading = false,
}: {
  title: string;
  link: LinkDTO | null;
  orgQr: OrgQr;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <Dialog open={!!link || loading} onOpenChange={(o) => !o && onClose()} title={title}>
      {link ? <LinkPreviewContent link={link} orgQr={orgQr} /> : loading && <LinkPreviewLoading />}
    </Dialog>
  );
}
