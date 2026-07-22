type Toast = (message: string, kind?: "info" | "error") => void;

export async function copyToClipboard(text: string, toast: Toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch (error) {
    toast("Could not copy to clipboard", "error");
    throw error;
  }
}
