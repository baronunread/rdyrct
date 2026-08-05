import { useEffect, useRef } from "react";
import QRCodeStyling, { type CornerSquareType, type CornerDotType } from "qr-code-styling";
import { Button } from "../ui/button";
import { Download } from "lucide-react";
import { hasTransparency, resolveLook, type QrLook } from "../lib/qr-look";
import posthog from "../lib/posthog";

function looksOptions(look: QrLook) {
  return {
    dotsOptions: { color: look.ink, type: look.dot },
    cornersSquareOptions: {
      color: look.eye,
      type: look.corner as CornerSquareType,
    },
    cornersDotOptions: {
      color: look.eye,
      type: look.corner as CornerDotType,
    },
    backgroundOptions: { color: look.bg },
  };
}

/** Pixel size of a downloaded code, independent of how big the preview is
 * on screen. A PNG is a bitmap: exported at preview size (~208px) it is
 * about 17mm wide at print resolution, which is unusable on anything
 * physical. SVG is vector and would scale either way. */
const DOWNLOAD_SIZE = 1024;

// qr-code-styling takes margin in pixels, so a fixed value would shrink the
// quiet zone to nothing relative to a 1024px code. Held as a ratio of the
// code's size instead, chosen to give exactly the previous 8px at the 208px
// default so the preview is unchanged.
const MARGIN_RATIO = 8 / 208;

function makeQR(url: string, size: number, look: QrLook) {
  return new QRCodeStyling({
    width: size,
    height: size,
    type: "svg",
    data: url,
    image: look.logo,
    margin: Math.round(size * MARGIN_RATIO),
    qrOptions: { errorCorrectionLevel: "H" },
    imageOptions: { margin: 4, imageSize: look.logoSize },
    ...looksOptions(look),
  });
}

/**
 * Live QR preview. Renders independent of the app theme so the code scans
 * reliably when downloaded. Every appearance prop is an override: empty /
 * undefined falls back to the built-in look, and callers pass the link's
 * overrides already resolved over the org's defaults.
 */
export function QRPreview({
  url,
  logo,
  size = 208,
  dotStyle,
  color,
  corner,
  eyeColor,
  bg,
  logoSize,
  downloadName,
}: {
  url: string;
  logo?: string;
  size?: number;
  /** QrDotStyle; empty/undefined = rounded */
  dotStyle?: string;
  /** hex ink color; empty/undefined = QR_DEFAULT_COLOR */
  color?: string;
  /** Corner style for the finder 'eyes'; empty/undefined = QR_DEFAULT_CORNER */
  corner?: string;
  /** hex accent color for the eyes; empty/undefined = follows `color` */
  eyeColor?: string;
  /** hex background or "transparent"; empty/undefined = QR_DEFAULT_BG */
  bg?: string;
  /** logo footprint ratio; empty/undefined = QR_DEFAULT_LOGO_SIZE */
  logoSize?: number;
  downloadName?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);

  const look = resolveLook({ logo, dotStyle, color, corner, eyeColor, bg, logoSize });

  useEffect(() => {
    if (!holder.current) return;
    if (!qr.current) {
      qr.current = makeQR(url, size, look);
      qr.current.append(holder.current);
    } else {
      qr.current.update({
        data: url,
        image: look.logo,
        imageOptions: { margin: 4, imageSize: look.logoSize },
        ...looksOptions(look),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, size, look.dot, look.corner, look.ink, look.eye, look.bg, look.logo, look.logoSize]);

  const download = async (extension: "png" | "svg") => {
    // Exported from a throwaway instance at DOWNLOAD_SIZE, not from the one
    // on screen: qr-code-styling rasterizes to a canvas at its own
    // width/height, so downloading from the preview inherits the preview's
    // pixel size. Resizing the visible instance instead would work but makes
    // it jump mid-download.
    const full = makeQR(url, DOWNLOAD_SIZE, look);
    await full.download({ name: downloadName ?? "qr", extension });
    posthog.capture("qr_code_downloaded", { format: extension });
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={holder}
        className="overflow-hidden rounded-lg border border-border [&_svg]:block"
        style={{
          width: size,
          height: size,
          // A checkerboard shows through where the QR is transparent.
          backgroundColor: "#ffffff",
          backgroundImage: hasTransparency(look.bg)
            ? "conic-gradient(from 90deg, #e7e7ea 90deg, #f7f7f9 0 180deg, #e7e7ea 0 270deg, #f7f7f9 0)"
            : undefined,
          backgroundSize: "16px 16px",
        }}
      />
      {downloadName !== undefined && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void download("png")}>
            <Download size={13} /> PNG
          </Button>
          <Button size="sm" onClick={() => void download("svg")}>
            <Download size={13} /> SVG
          </Button>
        </div>
      )}
    </div>
  );
}
