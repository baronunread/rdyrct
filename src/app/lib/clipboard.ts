import type { ToastOptions } from "../ui/toast";

type Toast = (message: string, kind?: "info" | "error", options?: ToastOptions) => void;

/** A copied URL is named in the toast ("Copied go.example.com/menu"); any
 * other text (an API key, a prompt) is not, so a secret never shows on
 * screen twice. */
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
