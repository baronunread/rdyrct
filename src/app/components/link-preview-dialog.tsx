import { Dialog } from "../ui/dialog";
import { CopyButton } from "../ui/copy-button";
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

/** The short URL and its QR code for one link, in a dialog: shared by "link
 * just created" (dashboard quick-create) and "show QR" (links table row
 * action). Same content, different title.
 *
 * The QR is here on every plan. Only its look (logo, colors, shapes) is
 * paid, and `orgQr` already resolves to the built-in defaults for a free
 * org, which cannot have set any. */
export function LinkPreviewDialog({
  title,
  link,
  orgQr,
  onClose,
}: {
  title: string;
  link: LinkDTO | null;
  orgQr: OrgQr;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()} title={title}>
      {link && <LinkPreviewContent link={link} orgQr={orgQr} />}
    </Dialog>
  );
}
