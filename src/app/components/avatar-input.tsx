import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/app/lib/error-message";
import { AVATAR_MAX_BYTES, AVATAR_MAX_DIMENSION, type User } from "@/shared/types";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { UserAvatar } from "./user-avatar";
import { uploadUserAvatar, deleteUserAvatar } from "../lib/api";

/** Crop the image to a centred square and re-encode as a small WebP. */
async function toSquareWebp(file: File): Promise<Blob> {
  const image = await createImageBitmap(file);
  try {
    const side = Math.min(image.width, image.height);
    const target = Math.min(side, AVATAR_MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this image");
    context.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      target,
      target,
    );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not encode this image"))),
        "image/webp",
        0.9,
      ),
    );
  } finally {
    image.close();
  }
}

async function prepare(file: File): Promise<Blob> {
  const square = await toSquareWebp(file);
  if (square.size <= AVATAR_MAX_BYTES) return square;
  const { default: imageCompression } = await import("browser-image-compression");
  return imageCompression(new File([square], "avatar.webp", { type: "image/webp" }), {
    maxSizeMB: AVATAR_MAX_BYTES / 1024 / 1024,
    maxWidthOrHeight: AVATAR_MAX_DIMENSION,
    useWebWorker: true,
  });
}

export function AvatarInput({ user }: { user: User }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["user"] });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadUserAvatar(await prepare(file));
      await refresh();
      toast("Picture updated");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await deleteUserAvatar();
      await refresh();
      toast("Picture removed");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <UserAvatar user={user} size={72} />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-bg/60">
            <Spinner />
          </span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <div className="flex flex-col items-center gap-0.5">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
          Change
        </Button>
        {user.image && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onRemove()}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
