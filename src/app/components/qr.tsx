import { useEffect, useRef } from "react";
import QRCodeStyling from "qr-code-styling";
import { Button } from "../ui/button";
import { Download } from "lucide-react";

function makeQR(url: string, logo: string | undefined, size: number) {
  return new QRCodeStyling({
    width: size,
    height: size,
    type: "svg",
    data: url,
    image: logo || undefined,
    margin: 8,
    dotsOptions: { color: "#17151f", type: "rounded" },
    cornersSquareOptions: { color: "#17151f", type: "extra-rounded" },
    backgroundOptions: { color: "#ffffff" },
    imageOptions: { margin: 4, imageSize: 0.35 },
  });
}

/**
 * Live QR preview. Always dark-on-white regardless of app theme so the code
 * scans reliably when downloaded.
 */
export function QRPreview({
  url,
  logo,
  size = 208,
  downloadName,
}: {
  url: string;
  logo?: string;
  size?: number;
  downloadName?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);

  useEffect(() => {
    if (!holder.current) return;
    if (!qr.current) {
      qr.current = makeQR(url, logo, size);
      qr.current.append(holder.current);
    } else {
      qr.current.update({ data: url, image: logo || undefined });
    }
  }, [url, logo, size]);

  const download = (extension: "png" | "svg") =>
    qr.current?.download({ name: downloadName ?? "qr", extension });

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={holder}
        className="overflow-hidden rounded-lg border border-border bg-white [&_svg]:block"
        style={{ width: size, height: size }}
      />
      {downloadName !== undefined && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => download("png")}>
            <Download size={13} /> PNG
          </Button>
          <Button size="sm" onClick={() => download("svg")}>
            <Download size={13} /> SVG
          </Button>
        </div>
      )}
    </div>
  );
}
