import type { UserOrg } from "@/shared/types";
import type { OrgQr } from "../components/link-editor";

/** Map a UserOrg's QR defaults into the OrgQr shape the editors consume. */
export function orgQrFrom(org?: UserOrg | null): OrgQr {
  return {
    logo: org?.qrLogo ?? "",
    style: org?.qrStyle ?? "",
    color: org?.qrColor ?? "",
    corner: org?.qrCorner ?? "",
    bg: org?.qrBg ?? "",
    eyeColor: org?.qrEyeColor ?? "",
    logoSize: org?.qrLogoSize ?? null,
  };
}
