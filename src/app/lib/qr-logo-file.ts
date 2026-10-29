/**
 * Turning a picked image into the logo a QR code carries: an optimized SVG
 * stays vector, anything else becomes a compressed square WebP, and the
 * result goes to the organization's bucket.
 *
 * The same steps as `components/qr-logo-input.tsx` (the dropzone the free
 * generator still uses), pulled out so the compact logo control in the QR
 * editor rows can share them. TODO(lead): make qr-logo-input.tsx import
 * these and drop its own copy.
 */
import { QR_LOGO_MAX_BYTES, QR_LOGO_MAX_DIMENSION } from "@/shared/types";
import { uploadQrLogo } from "./api";

/** Strip source metadata and animation by drawing the image into a fixed
 * square canvas. The transparent padding keeps non-square marks whole. */
async function rasterize(file: File): Promise<File> {
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

function isSvg(file: File) {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

/** Keep vector marks scalable while removing executable and linked content. */
async function optimizeSvg(file: File): Promise<File> {
  const { optimize } = await import("svgo/browser");
  const optimized = optimize(await file.text(), {
    multipass: true,
    plugins: [
      "preset-default",
      "removeScripts",
      // removeAttrs patterns split on ":", so "*:xlink:href" can't target the
      // namespaced xlink:href attribute; migrate it to plain href first.
      "removeXlink",
      { name: "removeAttrs", params: { attrs: ["*:href"] } },
    ],
  });
  const doc = new DOMParser().parseFromString(optimized.data, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") {
    throw new Error("Could not read this SVG file");
  }
  doc.querySelectorAll("foreignObject").forEach((element) => element.remove());
  const result = new File([new XMLSerializer().serializeToString(doc)], "qr-logo.svg", {
    type: "image/svg+xml",
  });
  if (result.size > QR_LOGO_MAX_BYTES) throw new Error("Logo could not be compressed below 256 KB");
  return result;
}

async function prepare(file: File): Promise<File> {
  if (isSvg(file)) return optimizeSvg(file);
  const [rasterized, { default: imageCompression }] = await Promise.all([
    rasterize(file),
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

/** Prepares the picked file and uploads it to the org: the URL to store. */
export async function uploadPreparedQrLogo(orgId: string, file: File): Promise<string> {
  // Dragged files bypass an input's accept filter, so check the type here.
  if (!file.type.startsWith("image/")) throw new Error("Logo must be an image file");
  return uploadQrLogo(orgId, await prepare(file));
}

/** Prepares the picked file the same way and keeps it in the browser, as a
 * data URL: for a plan that may try a logo but not store one. */
export async function readPreparedQrLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Logo must be an image file");
  const prepared = await prepare(file);
  const bytes = new Uint8Array(await prepared.arrayBuffer());
  let binary = "";
  // In chunks: one spread of 256 KB of arguments overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${prepared.type};base64,${btoa(binary)}`;
}
