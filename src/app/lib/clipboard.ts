import type { ToastOptions } from "../ui/toast";

type Toast = (message: string, kind?: "info" | "error", options?: ToastOptions) => void;

// Only a copied URL is named in the toast: a secret (an API key) must not show on screen twice.
function copiedCode(text: string): string | undefined {
  return /^https?:\/\/\S+$/.test(text) ? text.replace(/^https?:\/\//, "") : undefined;
}

export async function copyToClipboard(
  text: string,
  toast: Toast,
  messages?: { success?: string; error?: string },
) {
  try {
    await navigator.clipboard.writeText(text);
    if (messages?.success) toast(messages.success);
    else {
      const code = copiedCode(text);
      if (code) toast("Copied", "info", { code });
      else toast("Copied to clipboard");
    }
  } catch (error) {
    toast(messages?.error ?? "Could not copy to clipboard", "error");
    throw error;
  }
}
