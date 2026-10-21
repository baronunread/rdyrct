import { Suspense, lazy } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ConsentBanner } from "./ui/consent-banner";
import { POSTHOG_CONFIGURED } from "@/shared/site";

const NotFound = lazy(() => import("./routes/not-found").then((m) => ({ default: m.NotFound })));

/** Its own module so marketing-routes.tsx can hang pages off it without
 *  importing main.tsx, which imports marketing-routes.tsx. */
export const rootRoute = createRootRoute({
  component: () => (
    // The card pages get a blank fallback; the two header pages and the app
    // shell branch below bring their own. The consent banner sits inside the
    // boundary so it waits for the page it belongs to: on its own over an
    // empty screen it read as the whole site. A build with no PostHog has
    // nothing to ask consent for.
    <Suspense fallback={null}>
      <Outlet />
      {POSTHOG_CONFIGURED && <ConsentBanner />}
    </Suspense>
  ),
  notFoundComponent: NotFound,
});
