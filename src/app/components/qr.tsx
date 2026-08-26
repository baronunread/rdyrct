import { useEffect, useRef } from "react";
import { QR_CORNER_STYLES, QR_DEFAULT_CORNER } from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import QRCodeStyling, { type CornerSquareType, type CornerDotType } from "qr-code-styling";
import { Button } from "../ui/button";
import { Download } from "@/app/ui/icons";
import { eccFor, hasTransparency, imageOptionsFor, resolveLook, type QrLook } from "../lib/qr-look";
import { fillSeams } from "../lib/qr-seams";
import { cn } from "../ui/cn";
import posthog from "../lib/posthog";
import { useToast } from "../ui/toast";

/** The corner style, which both option bags take: every value in
 * QR_CORNER_STYLES is in each of their unions. */
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

/** Pixel size of a downloaded code, independent of how big the preview is
 * on screen. A PNG is a bitmap: exported at preview size (~208px) it is
 * about 17mm wide at print resolution, which is unusable on anything
 * physical. SVG is vector and would scale either way. */
const DOWNLOAD_SIZE = 1024;

/**
 * Renders the QR as an image data URL (PNG or SVG) at download resolution.
 *
 * For agent consumers (WebMCP): a browser file download lands on the person's
 * disk where a model cannot read it, so it falls back to a screenshot of the
 * page. Returning the bytes inline is what lets the agent show or attach the
 * actual code.
 */
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

/**
 * PNG and SVG download controls for a QR.
 *
 * Its own component so a caller can put them somewhere other than directly
 * under the code. The hero's link stack does exactly that: the QR column
 * with buttons attached is more than twice the height of the link beside it,
 * which leaves a hole no content wants to fill.
 *
 * Exported from a throwaway instance at DOWNLOAD_SIZE, not from whatever is
 * on screen: qr-code-styling rasterizes to a canvas at its own width and
 * height, so downloading from a 104px preview yields a 104px file.
 */
export function QrDownloadButtons({
  url,
  name,
  look,
  className,
  disabled,
}: {
  url: string;
  name: string;
  /** Omitted means the built-in defaults, which is what an unstyled QR uses. */
  look?: QrLook;
  className?: string;
  /** For callers that keep the row in place while there is nothing to
   * download yet, rather than letting it appear and shove the page down. */
  disabled?: boolean;
}) {
  const resolved = look ?? resolveLook({});
  const toast = useToast();
  const download = async (extension: "png" | "svg") => {
    try {
      await makeQR(url, DOWNLOAD_SIZE, resolved).download({ name, extension });
      posthog.capture("qr_code_downloaded", { format: extension });
    } catch {
      // Drawing at 1024px can fail on a browser short of memory, and the
      // save itself can be refused. Both used to leave the button looking
      // like it had worked and no file anywhere.
      toast("Could not make the file. Try again.", "error");
    }
  };
  return (
    <div className={cn("flex gap-2", className)}>
      {/* Named in full for assistive tech: these can sit beside a link
          rather than under the code, where "PNG" alone says nothing about
          what is being downloaded. */}
      <Button
        size="sm"
        disabled={disabled}
        aria-label="Download QR code as PNG"
        onClick={() => void download("png")}
      >
        <Download size={13} /> PNG
      </Button>
      <Button
        size="sm"
        disabled={disabled}
        aria-label="Download QR code as SVG"
        onClick={() => void download("svg")}
      >
        <Download size={13} /> SVG
      </Button>
    </div>
  );
}

// qr-code-styling takes margin in pixels, so a fixed value would shrink the
// quiet zone to nothing relative to a 1024px code. Held as a ratio of the
// code's size instead, chosen to give exactly the previous 8px at the 208px
// default so the preview is unchanged.
const MARGIN_RATIO = 8 / 208;

/**
 * Previews are drawn at this size and scaled down by CSS, never generated at
 * their display size.
 *
 * qr-code-styling gives every module a whole number of pixels, and whatever
 * does not divide evenly becomes white space around the code. At small
 * display sizes that remainder is most of the box: a 33-module code in a
 * 104px preview got 2px a module, so 66px of code sat inside 104px with 19px
 * of padding a side, over a third of the width. Generated at 1024 and scaled,
 * the same remainder is under 2% and the code fills its frame.
 *
 * It costs nothing: the output is SVG, so the browser scales it losslessly
 * and the extra "resolution" is a handful of larger path coordinates.
 */
const PREVIEW_RENDER_SIZE = 1024;

function makeQR(url: string, size: number, look: QrLook) {
  const qr = new QRCodeStyling({
    width: size,
    height: size,
    type: "svg",
    data: url,
    image: look.logo,
    margin: Math.round(size * MARGIN_RATIO),
    qrOptions: { errorCorrectionLevel: eccFor(look) },
    imageOptions: imageOptionsFor(look),
    ...looksOptions(look),
  });
  // Runs after every draw, on the same element the preview shows and the SVG
  // download serializes, so neither can ship the seams.
  qr.applyExtension(fillSeams);
  return qr;
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
  sizeClass,
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
  /** Tailwind sizing for the frame, when the box needs to change with the
   * viewport. Wins over `size`, which can only ever be one number. */
  sizeClass?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);

  const look = resolveLook({ logo, dotStyle, color, corner, eyeColor, bg, logoSize });

  useEffect(() => {
    if (!holder.current) return;
    if (!qr.current) {
      qr.current = makeQR(url, PREVIEW_RENDER_SIZE, look);
      qr.current.append(holder.current);
    } else {
      qr.current.update({
        // Fixed, unlike the container: the drawing is always PREVIEW_RENDER_SIZE
        // and CSS decides how big it looks, so `size` never reaches the
        // generator and a resize cannot strand it at a stale scale.
        width: PREVIEW_RENDER_SIZE,
        height: PREVIEW_RENDER_SIZE,
        margin: Math.round(PREVIEW_RENDER_SIZE * MARGIN_RATIO),
        data: url,
        image: look.logo,
        imageOptions: imageOptionsFor(look),
        ...looksOptions(look),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, look.dot, look.corner, look.ink, look.eye, look.bg, look.logo, look.logoSize]);

  // A class that sets the box wins; without one, the box is `size`.
  const box = sizeClass ? undefined : size;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={holder}
        // Labelled, because otherwise a QR is an unnamed blob of SVG to a
        // screen reader. The code encodes the URL, which is the useful thing
        // to announce.
        role="img"
        aria-label={`QR code for ${url}`}
        // The drawing is PREVIEW_RENDER_SIZE regardless; these make it fill
        // whatever box `size` asks for.
        className={cn(
          "overflow-hidden rounded-lg border border-border [&_svg]:block [&_svg]:h-full [&_svg]:w-full",
          sizeClass,
        )}
        style={{
          width: box,
          height: box,
          // A checkerboard shows through where the QR is transparent.
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
