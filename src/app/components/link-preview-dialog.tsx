import { Dialog } from "../ui/dialog";
import { CopyButton } from "../ui/copy-button";
import { Skeleton, SkeletonStatus } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { resolveQrLook, type OrgQr } from "../lib/org-qr";
import { QRPreview } from "./qr";
import type { LinkDTO } from "@/shared/types";

function LinkPreviewContent({ link, orgQr }: { link: LinkDTO; orgQr: OrgQr }) {
  const toast = useToast();
  const url = link.url;
  return (
    <div className="flex flex-col items-center gap-3">
      <QRPreview url={url} {...resolveQrLook(link, orgQr)} downloadName={`qr-${link.slug}`} />
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <p className="min-w-0 font-mono text-sm font-bold wrap-break-word">{url}</p>
        <CopyButton
          text={url}
          label={`Copy ${url}`}
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </div>
    </div>
  );
}

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

/** The QR shows on every plan; only its look is paid, and `orgQr` already resolves to the defaults for a free org. */
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
