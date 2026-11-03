/** Links to one link's page, or back: the link's QR code, title and address
 * travel between its row and the page header (`link-morph` in styles.css). */
const LINK_PAGE = /^\/links\/[^/]+$/;
const isLinkMorph = (from: string, to: string) =>
  (from === "/links" && LINK_PAGE.test(to)) || (LINK_PAGE.test(from) && to === "/links");

/** One Platform tab to another: its title and tab bar hold still while only
 * the tab's content crossfades (`platform` in styles.css). */
const isPlatformTab = (from: string, to: string) =>
  from.startsWith("/admin") && to.startsWith("/admin");

type AppPageTransition = ["app-page", ...("link-morph" | "platform")[]];

/**
 * Which navigations crossfade the page in the sheet (the `app-page` rules in
 * styles.css): a move from one app page to another. Not the first load, not
 * a change of range, tab or filter on the same page, and not a move into or
 * out of the app. Two moves add a type of their own on top.
 */
export function appPageTransitionTypes<L extends { pathname: string }>(
  change: { fromLocation?: L; toLocation: L; pathChanged: boolean },
  inApp: (location: L) => boolean,
): AppPageTransition | false {
  const { fromLocation, toLocation, pathChanged } = change;
  if (!fromLocation || !pathChanged) return false;
  if (!inApp(fromLocation) || !inApp(toLocation)) return false;
  const [from, to] = [fromLocation.pathname, toLocation.pathname];
  if (isLinkMorph(from, to)) return ["app-page", "link-morph"];
  if (isPlatformTab(from, to)) return ["app-page", "platform"];
  return ["app-page"];
}
