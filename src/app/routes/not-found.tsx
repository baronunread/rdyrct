import { lazy, Suspense, useContext } from "react";
import { Link } from "@tanstack/react-router";
import { HOME_LINK } from "../components/not-found-home";
import { NotFoundView } from "../components/not-found-view";
import { AppNotFound } from "../components/app-not-found";
import { InShell } from "../lib/in-shell";
import { AppShellSkeleton } from "../components/skeletons";
import { useShellUser } from "../lib/hooks";

// Lazy, so a public 404 never downloads the app to draw itself.
const SignedInNotFound = lazy(() =>
  import("./shell").then(({ AppShell, RequireAuth }) => ({
    default: () => (
      <RequireAuth>
        <AppShell>
          <AppNotFound />
        </AppShell>
      </RequireAuth>
    ),
  })),
);

/**
 * Every 404 the app draws. Inside the shell (a page the user cannot see),
 * the in-app page. Outside it, for somebody signed in, the same page with
 * the shell around it, so a mistyped app address keeps the sidebar. Anybody
 * else gets the public 404, the one short links show too.
 */
export function NotFound() {
  const inShell = useContext(InShell);
  const shell = useShellUser();
  if (inShell) return <AppNotFound />;
  if (shell)
    return (
      <Suspense fallback={<AppShellSkeleton />}>
        <SignedInNotFound />
      </Suspense>
    );
  return (
    <NotFoundView
      back={
        <Link to="/" className={HOME_LINK}>
          Go home
        </Link>
      }
    />
  );
}
