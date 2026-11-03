import { createElement, lazy, useState, type ComponentType } from "react";

/**
 * The welcome page's code, loaded once, the way lib/shell-loader.ts loads the
 * shell: the email code and Google hand their card over to it
 * (routes/auth.tsx, routes/welcome.tsx), and React.lazy would draw nothing
 * for a frame first even with the chunk in the browser.
 */
type Welcome = typeof import("../routes/welcome");
let welcomeLoaded: Welcome | undefined;
let welcomeLoading: Promise<Welcome> | undefined;

/** The welcome page's code, the same way: the email code and Google hand
 * their card over to it (routes/auth.tsx, routes/welcome.tsx). */
export function loadWelcome(): Promise<Welcome> {
  welcomeLoading ??= import("../routes/welcome").then(
    (m) => (welcomeLoaded = m),
    (error: Error) => {
      welcomeLoading = undefined;
      throw error;
    },
  );
  return welcomeLoading;
}

const WelcomeLazy = lazy(() => loadWelcome().then((m) => ({ default: m.WelcomePage })));
export function WelcomePagePart() {
  const [Part] = useState<ComponentType>(() => welcomeLoaded?.WelcomePage ?? WelcomeLazy);
  return createElement(Part);
}
