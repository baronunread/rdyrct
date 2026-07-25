type Toast = (message: string, kind?: "info" | "error") => void;

export async function copyToClipboard(
  text: string,
  toast: Toast,
  messages?: { success?: string; error?: string },
) {
  try {
    await navigator.clipboard.writeText(text);
    toast(messages?.success ?? "Copied to clipboard");
  } catch (error) {
    toast(messages?.error ?? "Could not copy to clipboard", "error");
    throw error;
  }
}
