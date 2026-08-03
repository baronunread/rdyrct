import { Dialog } from "../ui/dialog";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { shortUrl } from "../lib/api";
import { resolveQrLook, type OrgQr } from "../lib/org-qr";
import { QRPreview } from "./qr";
import type { LinkDTO } from "@/shared/types";

function LinkPreviewContent({
  link,
  qrEnabled,
  orgQr,
}: {
  link: LinkDTO;
  qrEnabled: boolean;
  orgQr: OrgQr;
}) {
  const toast = useToast();
  const url = shortUrl(link.slug, link.domain);
  return (
    <div className="flex flex-col items-center gap-3">
      {qrEnabled && (
        <QRPreview url={url} {...resolveQrLook(link, orgQr)} downloadName={`qr-${link.slug}`} />
      )}
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

/** The short URL (and its QR code, on paid plans) for one link, in a dialog:
 * shared by "link just created" (dashboard quick-create) and "show QR"
 * (links table row action) — same content, different title. */
export function LinkPreviewDialog({
  title,
  link,
  qrEnabled,
  orgQr,
  onClose,
}: {
  title: string;
  link: LinkDTO | null;
  qrEnabled: boolean;
  orgQr: OrgQr;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()} title={title}>
      {link && <LinkPreviewContent link={link} qrEnabled={qrEnabled} orgQr={orgQr} />}
    </Dialog>
  );
}
