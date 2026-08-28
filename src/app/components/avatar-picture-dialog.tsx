import { useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { errorMessage } from "@/app/lib/error-message";
import { AVATAR_MAX_DIMENSION } from "@/shared/types";
import { ImagePlus, Trash2 } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";

/** Draw the chosen crop rectangle onto a square canvas and hand back a WebP. */
async function cropToWebp(src: string, area: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not read this image"));
    el.src = src;
  });
  const side = Math.min(Math.round(area.width), AVATAR_MAX_DIMENSION);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare this image");
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, side, side);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode this image"))),
      "image/webp",
      0.9,
    ),
  );
}

function PickView({
  hasImage,
  onFile,
  onRemove,
  onClose,
}: {
  hasImage: boolean;
  onFile: (file: File | undefined) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          if (input.current) input.current.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2 px-6 py-10 text-sm text-muted transition-colors hover:border-accent hover:text-text"
      >
        <ImagePlus size={28} />
        <span className="font-medium text-text">Upload a picture</span>
        <span>PNG, JPEG or WebP, up to 256 KB</span>
      </button>
      <div className="flex items-center justify-between gap-2">
        {hasImage ? (
          <Button variant="ghost" className="text-danger hover:text-danger" onClick={onRemove}>
            <Trash2 size={15} /> Remove picture
          </Button>
        ) : (
          <span />
        )}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function CropView({
  src,
  busy,
  onBack,
  onApply,
}: {
  src: string;
  busy: boolean;
  onBack: () => void;
  onApply: (area: Area) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  return (
    <>
      <div className="relative h-64 w-full overflow-hidden rounded-lg bg-surface-2">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={1}
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- react-easy-crop prop name
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
        />
      </div>
      <label className="flex items-center gap-3 text-xs text-muted">
        Zoom
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1 accent-accent"
          aria-label="Zoom"
        />
      </label>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Choose another
        </Button>
        <Button variant="primary" onClick={() => area && onApply(area)} disabled={busy || !area}>
          Apply
        </Button>
      </div>
    </>
  );
}

export function AvatarPictureDialog({
  hasImage,
  onClose,
  onApply,
  onRemove,
}: {
  /** There is a picture to remove: a saved one, or a staged crop. */
  hasImage: boolean;
  onClose: () => void;
  onApply: (blob: Blob) => void;
  onRemove: () => void;
}) {
  const toast = useToast();
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSrc(String(reader.result));
    reader.onerror = () => toast("Could not read this image", "error");
    reader.readAsDataURL(file);
  };

  const applyCrop = async (area: Area) => {
    if (!src) return;
    setBusy(true);
    try {
      onApply(await cropToWebp(src, area));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title="Profile picture" onOpenChange={(o) => !o && onClose()}>
      <div className="flex flex-col gap-4">
        {src ? (
          <CropView src={src} busy={busy} onBack={() => setSrc(null)} onApply={applyCrop} />
        ) : (
          <PickView
            hasImage={hasImage}
            onFile={loadFile}
            onRemove={() => {
              onRemove();
              onClose();
            }}
            onClose={onClose}
          />
        )}
      </div>
    </Dialog>
  );
}
