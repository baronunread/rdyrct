import { useRef, useState } from "react";
import { Check, ImagePlus, X } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { QR_LOGO_MAX_BYTES, QR_LOGO_MAX_DIMENSION } from "@/shared/types";
import { useToast } from "../ui/toast";
import { Spinner } from "../ui/spinner";
import { uploadQrLogo } from "../lib/api";
import { useCurrentOrg } from "../lib/current-org";
import type { UserOrg } from "@/shared/types";

/** Where a prepared logo ends up: an organization's bucket, or nowhere at
 * all. The free generator has no organization, and a logo that never leaves
 * the browser is the honest version of a tool that draws the code there too. */
type LogoSink = { kind: "upload"; orgId: string } | { kind: "local" };

/** Nothing to upload to and not staying local means the picker is not ready:
 * the org query has not answered yet. */
function logoSink(org: UserOrg | null, local: boolean | undefined): LogoSink | null {
  if (local) return { kind: "local" };
  return org ? { kind: "upload", orgId: org.id } : null;
}

/** The prepared file as a data URL. */
function asDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read this image"));
    reader.readAsDataURL(file);
  });
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
        (result) => (result ? resolve(result) : reject(new Error("Could not encode this image"))),
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
      // removeAttrs patterns split on ":", so "*:xlink:href" can't target the
      // namespaced xlink:href attribute; migrate it to plain href first.
      "removeXlink",
      {
        name: "removeAttrs",
        params: { attrs: ["*:href"] },
      },
    ],
  });
  const document = new DOMParser().parseFromString(optimized.data, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
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

/** Converts a source image to the file that actually gets uploaded: an
 * optimized SVG stays vector, anything else becomes a compressed square WebP. */
async function prepareQrLogo(file: File): Promise<File> {
  if (isSvgFile(file)) return optimizeQrLogoSvg(file);
  // Rasterizing and loading the compression library depend on neither each
  // other nor anything already awaited, so they run concurrently.
  const [rasterized, { default: imageCompression }] = await Promise.all([
    rasterizeQrLogo(file),
    import("browser-image-compression"),
  ]);
  const compressed = await imageCompression(rasterized, {
    maxSizeMB: QR_LOGO_MAX_BYTES / 1024 / 1024,
    maxWidthOrHeight: QR_LOGO_MAX_DIMENSION,
    useWebWorker: true,
    fileType: "image/webp",
  });
  if (compressed.size > QR_LOGO_MAX_BYTES) {
    throw new Error("Logo could not be compressed below 256 KB");
  }
  return compressed;
}

function QrLogoButtonContent({ busy, value }: { busy: boolean; value?: string }) {
  if (busy) {
    return (
      <>
        <Spinner />
        <span>Preparing…</span>
      </>
    );
  }
  if (value) {
    return (
      <>
        <img
          src={value}
          alt="Uploaded logo"
          className="h-10 w-10 rounded border border-border bg-white object-contain"
        />
        <span className="flex items-center gap-1 text-text">
          <Check size={12} className="text-accent" /> Logo added
        </span>
        <span className="text-3xs text-muted">Drop a new image or browse to replace</span>
      </>
    );
  }
  return (
    <>
      <ImagePlus size={16} />
      <span>
        Drop an image or <span className="text-accent">browse</span>
      </span>
      <span className="text-3xs text-muted">
        Bitmap files become 512 × 512 WebP, up to 256 KB. SVGs stay vector.
      </span>
    </>
  );
}

function RemoveLogoButton({ onClear }: { onClear: () => void }) {
  return (
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
  );
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
  local,
}: {
  /** current logo URL ("" = none) — shows the loaded state */
  value?: string;
  onLoad: (url: string) => void;
  /** called when the user clicks the remove button inside the dropzone */
  onClear?: () => void;
  disabled?: boolean;
  /** Keep the image in the browser as a data URL instead of uploading it. */
  local?: boolean;
}) {
  const toast = useToast();
  const { org } = useCurrentOrg();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const sink = logoSink(org, local);

  /** Ready when there is a file, the picker is not gated, nothing is already
   * in flight, and there is somewhere for the logo to go. */
  const accepts = (file: File | undefined): file is File => !!file && !disabled && !busy && !!sink;

  /** The prepared logo, wherever this picker sends it. */
  const store = async (file: File): Promise<string> => {
    const prepared = await prepareQrLogo(file);
    return !sink || sink.kind === "local"
      ? asDataUrl(prepared)
      : uploadQrLogo(sink.orgId, prepared);
  };

  const readFile = async (file: File | undefined) => {
    if (!accepts(file)) return;
    // Dragged files bypass the input's accept filter, so check the type.
    if (!file.type.startsWith("image/")) {
      toast("Logo must be an image file", "error");
      return;
    }
    setBusy(true);
    try {
      onLoad(await store(file));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const open = () => inputRef.current?.click();

  return (
    <div className="relative">
      {/* Sibling, not nested: a <button> can't legally contain an <input> */}
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
      <Button
        type="button"
        variant="outline"
        aria-label="Upload a logo image"
        disabled={disabled || busy}
        onClick={() => !busy && open()}
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
          "h-24 w-full flex-col gap-1.5 border-dashed bg-bg px-3 text-xs font-normal text-muted select-none",
          dragging
            ? "border-accent text-text"
            : "enabled:hover:border-accent/60 enabled:hover:text-text",
        )}
      >
        <QrLogoButtonContent busy={busy} value={value} />
      </Button>
      {value && onClear && !busy && <RemoveLogoButton onClear={onClear} />}
    </div>
  );
}
