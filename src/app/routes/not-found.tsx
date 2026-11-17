import { lazy, Suspense, useContext } from "react";
import { Link } from "@tanstack/react-router";
import { HOME_LINK } from "../components/not-found-home";
import { NotFoundView } from "../components/not-found-view";
import { AppNotFound } from "../components/app-not-found";
import { InShell } from "../lib/in-shell";
import { AppShellSkeleton } from "../components/skeletons";
import { useShellUser } from "../lib/hooks";

// Lazy, so a public 404 never downloads the app.
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
