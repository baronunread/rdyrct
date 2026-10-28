/**
 * Which navigations crossfade the page in the sheet (the `app-page` rules in
 * styles.css): a move from one app page to another. Not the first load, not
 * a change of range, tab or filter on the same page, and not a move into or
 * out of the app.
 */
export function appPageTransitionTypes<L extends { pathname: string }>(
  change: { fromLocation?: L; toLocation: L; pathChanged: boolean },
  inApp: (location: L) => boolean,
): ["app-page"] | false {
  const { fromLocation, toLocation, pathChanged } = change;
  if (!fromLocation || !pathChanged) return false;
  return inApp(fromLocation) && inApp(toLocation) ? ["app-page"] : false;
}
