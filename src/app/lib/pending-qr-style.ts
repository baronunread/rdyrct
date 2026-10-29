/**
 * A QR style tried on Free, kept across the trip to checkout.
 *
 * Organization lets a free org try every QR default, and "Upgrade to save"
 * goes to Polar. The style waits here in sessionStorage (the tab that left
 * is the tab that comes back) and is saved to the org the first time the
 * app sees that org on a plan that may keep it: on /billing as the webhook
 * lands, or on /organization.
 *
 * A logo tried on Free never left the browser (the API refuses it), so it
 * travels as a data URL and is uploaded at save time.
 */
import { useEffect } from "react";
import * as v from "valibot";
import { useQueryClient } from "@tanstack/react-query";
import { PLAN_LIMITS } from "@/shared/types";
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

/** The style waiting for `orgId`, if any. Leaves it in place. */
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
  } catch {
    // Nothing to clear.
  }
}

async function logoUrl(orgId: string, logo: string): Promise<string> {
  if (!logo.startsWith("data:")) return logo;
  const blob = await (await fetch(logo)).blob();
  const ext = blob.type === "image/svg+xml" ? "svg" : "webp";
  return uploadQrLogo(orgId, new File([blob], `qr-logo.${ext}`, { type: blob.type }));
}

/** Saves a waiting style once its org is on a plan that keeps QR styles. */
export function useSavePendingQrStyle(): void {
  const currentUser = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const orgs = currentUser.data?.orgs;

  useEffect(() => {
    for (const org of orgs ?? []) {
      if (!PLAN_LIMITS[org.plan].qrCustom || org.locked) continue;
      const values = readPendingQrStyle(org.id);
      if (!values) continue;
      // Cleared before the request, so a second caller (or a re-render)
      // never saves it twice.
      clearPendingQrStyle();
      void (async () => {
        try {
          await api(`/orgs/${org.id}`, {
            method: "PATCH",
            body: {
              qrLogo: await logoUrl(org.id, values.qrLogo),
              qrStyle: values.qrStyle,
              qrColor: values.qrColor,
              qrCorner: values.qrCorner,
              qrBg: values.qrBg,
              qrEyeColor: values.qrEyeColor,
              qrLogoSize: values.qrLogoSize === "" ? null : Number(values.qrLogoSize),
            },
          });
          await qc.invalidateQueries({ queryKey: ["user"] });
          posthog.capture("qr_defaults_saved", { after_checkout: true });
          toast(`QR style saved for ${org.name}`);
        } catch (e) {
          toast(errorMessage(e), "error");
        }
      })();
      return;
    }
  }, [orgs, qc, toast]);
}
