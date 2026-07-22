import { useEffect, useRef, useState } from "react";
import QRCodeStyling, {
  type DotType,
  type CornerSquareType,
  type CornerDotType,
} from "qr-code-styling";
import { Button } from "../ui/button";
import { Check, Download, ImagePlus, X } from "lucide-react";
import { cn } from "../ui/cn";
import {
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DEFAULT_LOGO_SIZE,
  QR_LOGO_MAX_BYTES,
  QR_LOGO_MAX_DIMENSION,
} from "@/shared/types";
import { useToast } from "../ui/toast";
import { Spinner } from "../ui/spinner";
import { uploadQrLogo } from "../lib/api";
import { useCurrentOrg } from "../lib/current-org";

/** All of a QR code's appearance, already resolved to concrete values. */
interface QrLook {
  dot: DotType;
  corner: string;
  ink: string;
  eye: string;
  bg: string;
  logo: string | undefined;
  logoSize: number;
}

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

function makeQR(url: string, size: number, look: QrLook) {
  return new QRCodeStyling({
    width: size,
    height: size,
    type: "svg",
    data: url,
    image: look.logo,
    margin: 8,
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

  const ink = color || QR_DEFAULT_COLOR;
  const look: QrLook = {
    dot: (dotStyle || "rounded") as DotType,
    corner: corner || QR_DEFAULT_CORNER,
    ink,
    eye: eyeColor || ink,
    bg: bg === "transparent" ? "transparent" : bg || QR_DEFAULT_BG,
    logo: logo || undefined,
    logoSize: logoSize || QR_DEFAULT_LOGO_SIZE,
  };

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
  }, [
    url,
    size,
    look.dot,
    look.corner,
    look.ink,
    look.eye,
    look.bg,
    look.logo,
    look.logoSize,
  ]);

  const download = (extension: "png" | "svg") =>
    qr.current?.download({ name: downloadName ?? "qr", extension });

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
          backgroundImage:
            look.bg === "transparent"
              ? "conic-gradient(from 90deg, #e7e7ea 90deg, #f7f7f9 0 180deg, #e7e7ea 0 270deg, #f7f7f9 0)"
              : undefined,
          backgroundSize: "16px 16px",
        }}
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

/**
 * One labeled color control (native swatch + optional transparent toggle) for
 * the QR editors. `value` is an override: "" shows `fallback` and means
 * inherit/default; picking a color or toggling transparent sets it. Shared by
 * the org QR defaults (Settings) and the per-link overrides (link editor).
 */
export function QrColorField({
  label,
  value,
  fallback,
  onChange,
  allowTransparent,
  disabled,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
  allowTransparent?: boolean;
  disabled?: boolean;
}) {
  const isTransparent = value === "transparent";
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="truncate text-2xs tracking-wider text-muted uppercase">
          {label}
        </span>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="shrink-0 cursor-pointer text-3xs tracking-wider text-muted uppercase hover:text-text"
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={isTransparent ? "#ffffff" : value || fallback}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isTransparent}
          aria-label={label}
          className="h-9 w-full min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-bg p-1 disabled:cursor-default disabled:opacity-50"
        />
        {allowTransparent && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-2xs text-muted select-none">
            <input
              type="checkbox"
              checked={isTransparent}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? "transparent" : "")}
              className="cursor-pointer accent-accent"
            />
            None
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Strip source metadata and animation by drawing the image into a fixed square
 * canvas. The transparent padding keeps non-square marks from being cropped.
 */
async function rasterizeQrLogo(file: File): Promise<File> {
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = QR_LOGO_MAX_DIMENSION;
    canvas.height = QR_LOGO_MAX_DIMENSION;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this image");

    const scale = Math.min(
      QR_LOGO_MAX_DIMENSION / image.width,
      QR_LOGO_MAX_DIMENSION / image.height,
    );
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(
      image,
      (QR_LOGO_MAX_DIMENSION - width) / 2,
      (QR_LOGO_MAX_DIMENSION - height) / 2,
      width,
      height,
    );

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("Could not encode this image")),
        "image/webp",
        0.92,
      ),
    );
    return new File([blob], "qr-logo.webp", { type: "image/webp" });
  } finally {
    image.close();
  }
}

function isSvgFile(file: File) {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

/** Keep vector marks scalable while removing executable and linked content. */
async function optimizeQrLogoSvg(file: File): Promise<File> {
  const { optimize: optimizeSvg } = await import("svgo/browser");
  const optimized = optimizeSvg(await file.text(), {
    multipass: true,
    plugins: [
      "preset-default",
      "removeScripts",
      {
        name: "removeAttrs",
        params: { attrs: ["*:href", "*:xlink:href"] },
      },
    ],
  });
  const document = new DOMParser().parseFromString(optimized.data, "image/svg+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "svg"
  ) {
    throw new Error("Could not read this SVG file");
  }
  document.querySelectorAll("foreignObject").forEach((element) => element.remove());
  const sanitized = new XMLSerializer().serializeToString(document);
  const result = new File([sanitized], "qr-logo.svg", { type: "image/svg+xml" });
  if (result.size > QR_LOGO_MAX_BYTES) {
    throw new Error("Logo could not be compressed below 256 KB");
  }
  return result;
}

/**
 * Dropzone-style image picker that converts source images to a square WebP
 * before upload. Shared by the org QR defaults (Settings) and per-link edits.
 */
export function QrLogoInput({
  value,
  onLoad,
  onClear,
  disabled,
}: {
  /** current logo URL ("" = none) — shows the loaded state */
  value?: string;
  onLoad: (url: string) => void;
  /** called when the user clicks the remove button inside the dropzone */
  onClear?: () => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const { org } = useCurrentOrg();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const readFile = async (file: File | undefined) => {
    if (!file || disabled || busy || !org) return;
    // Dragged files bypass the input's accept filter, so check the type.
    if (!file.type.startsWith("image/")) {
      toast("Logo must be an image file", "error");
      return;
    }
    setBusy(true);
    try {
      if (isSvgFile(file)) {
        onLoad(await uploadQrLogo(org.id, await optimizeQrLogoSvg(file)));
        return;
      }
      const rasterized = await rasterizeQrLogo(file);
      const { default: imageCompression } = await import(
        "browser-image-compression"
      );
      const compressed = await imageCompression(rasterized, {
        maxSizeMB: QR_LOGO_MAX_BYTES / 1024 / 1024,
        maxWidthOrHeight: QR_LOGO_MAX_DIMENSION,
        useWebWorker: true,
        fileType: "image/webp",
      });
      if (compressed.size > QR_LOGO_MAX_BYTES) {
        throw new Error("Logo could not be compressed below 256 KB");
      }
      onLoad(await uploadQrLogo(org.id, compressed));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const open = () => inputRef.current?.click();

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload a logo image"
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && !busy && open()}
        onKeyDown={(e) => !disabled && !busy && (e.key === "Enter" || e.key === " ") && open()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          readFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-bg px-3 h-24 text-xs text-muted transition-colors select-none focus-visible:outline-2 focus-visible:outline-accent/60 aria-disabled:cursor-default aria-disabled:opacity-50",
          dragging
            ? "border-accent text-text"
            : "not-aria-disabled:hover:border-accent/60 not-aria-disabled:hover:text-text",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            readFile(e.target.files?.[0]);
            // reset so picking the same file again re-fires onChange
            e.target.value = "";
          }}
        />
        {busy ? (
          <>
            <Spinner />
            <span>Preparing and uploading…</span>
          </>
        ) : value ? (
          <>
            <img
              src={value}
              alt="Uploaded logo"
              className="h-10 w-10 rounded border border-border bg-white object-contain"
            />
            <span className="flex items-center gap-1 text-text">
              <Check size={12} className="text-accent" /> Logo added
            </span>
            <span className="text-3xs text-muted/70">
              Drop a new image or browse to replace
            </span>
          </>
        ) : (
          <>
            <ImagePlus size={16} />
            <span>
              Drop an image or <span className="text-accent">browse</span>
            </span>
            <span className="text-3xs text-muted/70">
              Bitmap files become 512 × 512 WebP, up to 256 KB. SVGs stay vector.
            </span>
          </>
        )}
      </div>
      {value && onClear && !busy && (
        <button
          type="button"
          aria-label="Remove logo"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 flex cursor-pointer items-center justify-center rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
