function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function isShortcut(e: KeyboardEvent, key: string): boolean {
  const taken = [e.defaultPrevented, e.metaKey, e.ctrlKey, e.altKey].some(Boolean);
  return !taken && e.key.toLowerCase() === key && !typingIn(e.target);
}

export function openCommandMenu() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
}

// Ctrl everywhere else: the command menu listens for Ctrl+K there and ⌘ means nothing.
export const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
