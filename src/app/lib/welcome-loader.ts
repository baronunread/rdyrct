import { createElement, lazy, useState, type ComponentType } from "react";

// Loaded once, like shell-loader.ts: React.lazy would draw nothing for a frame
// first, even with the chunk in the browser.
type Welcome = typeof import("../routes/welcome");
let welcomeLoaded: Welcome | undefined;
let welcomeLoading: Promise<Welcome> | undefined;

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
