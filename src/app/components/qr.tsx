import { useEffect, useRef } from "react";
import { QR_CORNER_STYLES, QR_DEFAULT_CORNER } from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import QRCodeStyling, {
  type CornerSquareType,
  type CornerDotType,
  type Options,
} from "qr-code-styling";
import { Button } from "../ui/button";
import { Download } from "@/app/ui/icons";
import { eccFor, hasTransparency, imageOptionsFor, resolveLook, type QrLook } from "../lib/qr-look";
import { fillSeams } from "../lib/qr-seams";
import { cn } from "../ui/cn";
import posthog from "../lib/posthog";
import { useToast } from "../ui/toast";

const cornerStyle = (style: string): CornerSquareType & CornerDotType =>
  oneOf(QR_CORNER_STYLES, style, QR_DEFAULT_CORNER);

function looksOptions(look: QrLook) {
  return {
    dotsOptions: { color: look.ink, type: look.dot },
    cornersSquareOptions: { color: look.eye, type: cornerStyle(look.corner) },
    cornersDotOptions: { color: look.eye, type: cornerStyle(look.corner) },
    backgroundOptions: { color: look.bg },
  };
}

/** A PNG is a bitmap: exported at preview size (~208px) it prints about 17mm wide.
 * SVG scales either way. */
const DOWNLOAD_SIZE = 1024;

/** Returns the bytes inline: a browser download lands where an agent (WebMCP) cannot read it. */
export async function qrDataUrl(
  url: string,
  look: QrLook,
  extension: "png" | "svg",
): Promise<string> {
  const raw = await makeQR(url, DOWNLOAD_SIZE, look).getRawData(extension);
  if (!raw) throw new Error("Could not render the QR code.");
  const bytes = raw instanceof Blob ? new Uint8Array(await raw.arrayBuffer()) : new Uint8Array(raw);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const media = extension === "svg" ? "svg+xml" : "png";
  return `data:image/${media};base64,${btoa(binary)}`;
}

/** Exports from a throwaway instance at DOWNLOAD_SIZE: qr-code-styling rasterizes at its own
 * width and height, so exporting the 104px preview would give a 104px file. */
export function QrDownloadButtons({
  url,
  name,
  look,
  className,
  disabled,
  prominent,
}: {
  url: string;
  name: string;
  look?: QrLook;
  className?: string;
  disabled?: boolean;
  prominent?: boolean;
}) {
  const resolved = look ?? resolveLook({});
  const toast = useToast();
  const download = async (extension: "png" | "svg") => {
    try {
      await makeQR(url, DOWNLOAD_SIZE, resolved).download({ name, extension });
      posthog.capture("qr_code_downloaded", { format: extension });
    } catch {
      // Drawing at 1024px can fail on a low-memory browser, and the save can be refused.
      toast("Could not make the file. Try again.", "error");
    }
  };
  const style = prominent ? PROMINENT : PLAIN;
  return (
    <div className={cn("flex gap-2", className)}>
      <Button
        size={style.size}
        variant={style.png}
        disabled={disabled}
        aria-label="Download QR code as PNG"
        onClick={() => void download("png")}
      >
        <Download size={style.icon} /> {style.pngLabel}
      </Button>
      <Button
        size={style.size}
        variant={style.svg}
        disabled={disabled}
        aria-label="Download QR code as SVG"
        onClick={() => void download("svg")}
      >
        <Download size={style.icon} /> SVG
      </Button>
    </div>
  );
}

const PLAIN = { size: "sm", png: undefined, svg: undefined, icon: 13, pngLabel: "PNG" } as const;
const PROMINENT = {
  size: "md",
  png: "primary",
  svg: "outline",
  icon: 15,
  pngLabel: "Download PNG",
} as const;

// qr-code-styling takes margin in pixels, so a ratio keeps the quiet zone in proportion at 1024px
// (8px at the 208px default).
const MARGIN_RATIO = 8 / 208;

/** Previews draw at this size and CSS scales them down: modules get whole pixels, and the
 * remainder becomes white space (a 33-module code in 104px lost over a third of its width). */
const PREVIEW_RENDER_SIZE = 1024;

const levelFor = (look: QrLook, roomForLogo = false) => (roomForLogo ? "H" : eccFor(look));

/** Fixed size, so a resize cannot strand a stale scale. Carries the correction level so a logo
 * added after the first draw gives the same code as the download. */
function previewUpdate(url: string, look: QrLook, roomForLogo?: boolean): Partial<Options> {
  return {
    width: PREVIEW_RENDER_SIZE,
    height: PREVIEW_RENDER_SIZE,
    margin: Math.round(PREVIEW_RENDER_SIZE * MARGIN_RATIO),
    data: url,
    image: look.logo,
    qrOptions: { errorCorrectionLevel: levelFor(look, roomForLogo) },
    imageOptions: imageOptionsFor(look),
    ...looksOptions(look),
  };
}

function makeQR(url: string, size: number, look: QrLook, roomForLogo = false) {
  const qr = new QRCodeStyling({
    width: size,
    height: size,
    type: "svg",
    data: url,
    image: look.logo,
    margin: Math.round(size * MARGIN_RATIO),
    qrOptions: { errorCorrectionLevel: levelFor(look, roomForLogo) },
    imageOptions: imageOptionsFor(look),
    ...looksOptions(look),
  });
  // Runs after every draw, on the element the preview shows and the SVG download serializes.
  qr.applyExtension(fillSeams);
  return qr;
}

export function QRPreview({
  url,
  logo,
  size = 208,
  sizeClass,
  dotStyle,
  color,
  corner,
  eyeColor,
  bg,
  logoSize,
  downloadName,
  roomForLogo,
  label,
}: {
  url: string;
  label?: string;
  /** Draws at a logo's error correction with no logo, so a caller's own logo can crossfade. */
  roomForLogo?: boolean;
  logo?: string;
  size?: number;
  dotStyle?: string;
  color?: string;
  corner?: string;
  eyeColor?: string;
  bg?: string;
  logoSize?: number;
  downloadName?: string;
  sizeClass?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);

  const look = resolveLook({ logo, dotStyle, color, corner, eyeColor, bg, logoSize });

  useEffect(() => {
    if (!holder.current) return;
    if (!qr.current) {
      qr.current = makeQR(url, PREVIEW_RENDER_SIZE, look, roomForLogo);
      qr.current.append(holder.current);
    } else {
      qr.current.update(previewUpdate(url, look, roomForLogo));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, look.dot, look.corner, look.ink, look.eye, look.bg, look.logo, look.logoSize]);

  const box = sizeClass ? undefined : size;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={holder}
        role="img"
        aria-label={label ?? `QR code for ${url}`}
        className={cn(
          "overflow-hidden rounded-lg border border-border [&_svg]:block [&_svg]:h-full [&_svg]:w-full",
          sizeClass,
        )}
        style={{
          width: box,
          height: box,
          backgroundColor: "#ffffff",
          backgroundImage: hasTransparency(look.bg)
            ? "conic-gradient(from 90deg, #e7e7ea 90deg, #f7f7f9 0 180deg, #e7e7ea 0 270deg, #f7f7f9 0)"
            : undefined,
          backgroundSize: "16px 16px",
        }}
      />
      {downloadName !== undefined && (
        <QrDownloadButtons url={url} name={downloadName} look={look} />
      )}
    </div>
  );
}
