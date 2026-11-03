/** True when a key press belongs to whatever has focus, not to a shortcut. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * Whether `e` is the bare `key` meant as an app shortcut: no modifier, not
 * typed into a field, and not already taken by something else (the
 * dashboard's first-run field catches every keystroke).
 */
export function isShortcut(e: KeyboardEvent, key: string): boolean {
  const taken = [e.defaultPrevented, e.metaKey, e.ctrlKey, e.altKey].some(Boolean);
  return !taken && e.key.toLowerCase() === key && !typingIn(e.target);
}

/** Opens ⌘K the way its own shortcut does: from a button, a menu item, the
 * 404 page. Here rather than beside the palette so a caller does not pull
 * the palette's code in with it. */
export function openCommandMenu() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
}

/** ⌘ on a Mac (and iPad with a keyboard), Ctrl everywhere else, where the
 * command menu listens for Ctrl+K and ⌘ means nothing. */
export const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
