/**
 * Whether a click on a link is the plain in-page navigation the app should
 * take over, rather than one the browser keeps for itself (new tab, new
 * window, download) or one something else has already dealt with.
 */
export function isPlainLeftClick(event: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  return !event.defaultPrevented && event.button === 0 && !modified;
}
