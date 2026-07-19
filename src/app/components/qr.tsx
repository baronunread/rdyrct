import { useEffect, useRef, type ChangeEvent } from "react";
import QRCodeStyling, { type DotType } from "qr-code-styling";
import { Button } from "../ui/button";
import { Download } from "lucide-react";
import { QR_DEFAULT_COLOR, type QrDotStyle } from "@/shared/types";
import { useToast } from "../ui/toast";

function makeQR(
  url: string,
  logo: string | undefined,
  size: number,
  dotStyle: DotType,
  color: string,
) {
  return new QRCodeStyling({
    width: size,
    height: size,
    type: "svg",
    data: url,
    image: logo || undefined,
    margin: 8,
    dotsOptions: { color, type: dotStyle },
    cornersSquareOptions: { color, type: "extra-rounded" },
    cornersDotOptions: { color },
    backgroundOptions: { color: "#ffffff" },
    imageOptions: { margin: 4, imageSize: 0.35 },
  });
}

/**
 * Live QR preview. Always dark-on-white regardless of app theme so the code
 * scans reliably when downloaded. `dotStyle`/`color` default to the built-in
 * look; callers pass the link's overrides resolved over the org's defaults.
 */
export function QRPreview({
  url,
  logo,
  size = 208,
  dotStyle,
  color,
  downloadName,
}: {
  url: string;
  logo?: string;
  size?: number;
  /** QrDotStyle; empty/undefined = rounded */
  dotStyle?: string;
  /** hex ink color; empty/undefined = QR_DEFAULT_COLOR */
  color?: string;
  downloadName?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);

  const style: DotType = (dotStyle || "rounded") as QrDotStyle as DotType;
  const ink = color || QR_DEFAULT_COLOR;

  useEffect(() => {
    if (!holder.current) return;
    if (!qr.current) {
      qr.current = makeQR(url, logo, size, style, ink);
      qr.current.append(holder.current);
    } else {
      qr.current.update({
        data: url,
        image: logo || undefined,
        dotsOptions: { color: ink, type: style },
        cornersSquareOptions: { color: ink, type: "extra-rounded" },
        cornersDotOptions: { color: ink },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, logo, size, style, ink]);

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

/** data-URI logos are stored inline in D1 — keep them tiny. */
export const MAX_QR_LOGO_BYTES = 96 * 1024;

/**
 * File picker that reads an image into a data URI (≤ 96 KB). Shared by the
 * org QR defaults (Settings) and the per-link override (link editor).
 */
export function QrLogoInput({
  onLoad,
  disabled,
}: {
  onLoad: (dataUri: string) => void;
  disabled?: boolean;
}) {
  const toast = useToast();

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_QR_LOGO_BYTES) {
      toast("Logo too large (max 96 KB)", "error");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onLoad(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <input
      type="file"
      accept="image/*"
      disabled={disabled}
      onChange={onChange}
      className="w-full cursor-pointer text-xs text-muted file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface file:px-2.5 file:py-1.5 file:text-xs file:text-text disabled:opacity-50"
    />
  );
}
