const LINK_PAGE = /^\/links\/[^/]+$/;
const isLinkMorph = (from: string, to: string) =>
  (from === "/links" && LINK_PAGE.test(to)) || (LINK_PAGE.test(from) && to === "/links");

const isPlatformTab = (from: string, to: string) =>
  from.startsWith("/admin") && to.startsWith("/admin");

type AppPageTransition = ["app-page", ...("link-morph" | "platform")[]];

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
