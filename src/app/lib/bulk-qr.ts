import type { LinkDTO } from "@/shared/types";
import { qrDataUrl } from "../components/qr";
import { resolveLook } from "./qr-look";
import { resolveQrLook, type OrgQr } from "./org-qr";
import { downloadBlob } from "./csv";
import { zipStored } from "./zip";

/** "go.example.com-menu.png": the address, safe as a file name. */
function fileName(link: LinkDTO): string {
  const host = new URL(link.url).host;
  return `${host}-${link.slug}`.replace(/[^\w.-]+/g, "-") + ".png";
}

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Each link's QR code as a 1024px PNG, in its own look over the org's
 * defaults (what the QR dialog downloads one at a time), zipped into one
 * file. One link skips the zip.
 *
 * One after another rather than all at once: each is a 1024px canvas, and
 * twenty-five of those together is the kind of memory a phone refuses.
 */
export async function downloadQrCodes(links: LinkDTO[], orgQr: OrgQr): Promise<void> {
  const files: { name: string; data: Uint8Array }[] = [];
  for (const link of links) {
    const look = resolveLook(resolveQrLook(link, orgQr));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- one canvas at a time on purpose, see above.
    files.push({ name: fileName(link), data: bytesOf(await qrDataUrl(link.url, look, "png")) });
  }
  if (files.length === 1) {
    downloadBlob(files[0].name, new Blob([files[0].data.slice().buffer], { type: "image/png" }));
    return;
  }
  downloadBlob(`qr-codes-${files.length}.zip`, zipStored(files));
}
