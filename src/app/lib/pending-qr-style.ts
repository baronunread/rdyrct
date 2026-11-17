// A logo tried on Free never left the browser (the API refuses it), so it travels
// as a data URL and is uploaded at save time. The style waits in sessionStorage:
// the tab that left for checkout is the tab that comes back.
import { useEffect } from "react";
import * as v from "valibot";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, uploadQrLogo } from "./api";
import { useCurrentUser } from "./hooks";
import type { QrValues } from "./qr-look";
import { errorMessage } from "./error-message";
import { useToast } from "../ui/toast";
import posthog from "./posthog";

const KEY = "rdyrct:pending-qr-style";

const pendingSchema = v.object({
  orgId: v.string(),
  values: v.object({
    qrStyle: v.string(),
    qrColor: v.string(),
    qrLogo: v.string(),
    qrCorner: v.string(),
    qrBg: v.string(),
    qrEyeColor: v.string(),
    qrLogoSize: v.string(),
  }),
});

type Pending = v.InferOutput<typeof pendingSchema>;

export function keepPendingQrStyle(pending: Pending): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Storage full or blocked: checkout still works, the style is lost.
  }
}

export function readPendingQrStyle(orgId: string): QrValues | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = v.safeParse(pendingSchema, JSON.parse(raw));
    return parsed.success && parsed.output.orgId === orgId ? parsed.output.values : null;
  } catch {
    return null;
  }
}

function clearPendingQrStyle(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

function fileFromDataUrl(dataUrl: string): File {
  const [head, body = ""] = dataUrl.split(",");
  const type = head.slice("data:".length).split(";")[0] || "image/webp";
  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  // The upload reads the type, not the name.
  return new File([bytes], `qr-logo.${type.slice("image/".length).replace("+xml", "")}`, { type });
}

async function saveStyle(orgId: string, values: QrValues): Promise<void> {
  const logo = values.qrLogo.startsWith("data:")
    ? await uploadQrLogo(orgId, fileFromDataUrl(values.qrLogo))
    : values.qrLogo;
  await api(`/orgs/${orgId}`, {
    method: "PATCH",
    body: {
      qrLogo: logo,
      qrStyle: values.qrStyle,
      qrColor: values.qrColor,
      qrCorner: values.qrCorner,
      qrBg: values.qrBg,
      qrEyeColor: values.qrEyeColor,
      qrLogoSize: values.qrLogoSize === "" ? null : Number(values.qrLogoSize),
    },
  });
}

export function useSavePendingQrStyle(): void {
  const currentUser = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const { mutate } = useMutation({
    mutationFn: ({ orgId, values }: { orgId: string; name: string; values: QrValues }) =>
      saveStyle(orgId, values),
    onSuccess: async (_, { name }) => {
      await qc.invalidateQueries({ queryKey: ["user"] });
      posthog.capture("qr_defaults_saved", { after_checkout: true });
      toast(`QR style saved for ${name}`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const orgs = currentUser.data?.orgs;

  useEffect(() => {
    const org = orgs?.find(
      (o) => o.limits.qrCustom && !o.locked && readPendingQrStyle(o.id) !== null,
    );
    const values = org && readPendingQrStyle(org.id);
    if (!org || !values) return;
    // Cleared before the request, so a second caller (or a re-render)
    // never saves it twice.
    clearPendingQrStyle();
    mutate({ orgId: org.id, name: org.name, values });
  }, [orgs, mutate]);
}
