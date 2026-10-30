import { createRoute, lazyRouteComponent, Outlet } from "@tanstack/react-router";
import { LandingHeader } from "./components/landing-header";
import { readAuthHint } from "./lib/user-cache";
import { rootRoute } from "./root-route";

/**
 * The marketing pages that carry the landing header, and the header itself
 * while their chunk downloads.
 *
 * It rides in the entry chunk (a few hundred bytes) rather than waiting for
 * the page's, so somebody arriving here sees the site's header on the first
 * frame and the page fills in under it, instead of watching an empty screen
 * with a cookie banner on it. Same wrapper as every page in the group uses,
 * so nothing moves when the real one takes over.
 *
 * The card pages (login, signup, invite) are deliberately not in here: they
 * have no header, and showing one would be a flash of the wrong thing.
 *
 * Nothing here touches the scroll. This component re-renders the moment the
 * router's store changes, which is a long way before the page it points at
 * exists: the next page is a lazy chunk, so for the length of that download
 * React is still showing the OLD page while `useLocation()` here already
 * reads the new path. A scroll reset from this component therefore moved the
 * page the visitor was leaving. Arriving at the top is handled at both ends
 * of the navigation instead, by code that runs when the new page is really
 * on screen: see components/marketing-link.tsx and lib/marketing-scroll.ts.
 */
function PublicPages() {
  return <Outlet />;
}

/**
 * What stands in while a marketing page's chunk is on its way.
 *
 * The router loads that chunk itself now (lazyRouteComponent below), so
 * there is no Suspense boundary left to fall back to. On a navigation the
 * router keeps the page you are on rather than showing this, which is the
 * point; this is for the cold load, where the alternative is an empty screen
 * with a cookie banner on it. Same wrapper the real pages use, so nothing
 * moves when one takes over.
 *
 * `pendingMs: 0` so a cold load paints it on the first frame instead of after
 * the router's one-second grace. That is safe only because a marketing
 * navigation never reaches a pending state: MarketingLink loads the route
 * before it commits, so the page you are on stays until the next one is ready.
 */
function PublicPagePending() {
  return (
    <div className="page-column">
      <LandingHeader authed={readAuthHint()} />
    </div>
  );
}

/**
 * rdyrct.com's own pages: the landing, pricing, docs, the comparisons, its
 * legal text. main.tsx calls this only when the build is rdyrct.com
 * (RDYRCT_SITE), and everything is created in here rather than at the top of
 * the module so that a self-hosted build, which never calls it, drops every
 * page and its chunk.
 */
export function marketingRoutes() {
  const page = { pendingComponent: PublicPagePending, pendingMs: 0 };
  const alternatives = () => import("./routes/alternatives");

  // Pathless layout: adds the marketing header/scroll-reset wrapper without
  // an extra URL segment.
  const layout = createRoute({
    getParentRoute: () => rootRoute,
    id: "public-layout",
    component: PublicPages,
  });
  const child = { getParentRoute: () => layout, ...page };

  return layout.addChildren([
    createRoute({
      ...child,
      path: "/",
      component: lazyRouteComponent(() => import("./routes/landing"), "LandingPage"),
    }),
    createRoute({
      ...child,
      path: "/qr-code-generator",
      component: lazyRouteComponent(() => import("./routes/qr-generator"), "QrGeneratorPage"),
    }),
    createRoute({
      ...child,
      path: "/utm-builder",
      component: lazyRouteComponent(() => import("./routes/utm-builder"), "UtmBuilderPage"),
    }),
    createRoute({
      ...child,
      path: "/branded-link-shortener",
      component: lazyRouteComponent(
        () => import("./routes/branded-link-shortener"),
        "BrandedLinkShortenerPage",
      ),
    }),
    createRoute({
      ...child,
      path: "/pricing",
      component: lazyRouteComponent(() => import("./routes/pricing"), "PricingPage"),
    }),
    createRoute({
      ...child,
      path: "/roadmap",
      component: lazyRouteComponent(() => import("./routes/roadmap"), "RoadmapPage"),
    }),
    createRoute({
      ...child,
      path: "/changelog",
      component: lazyRouteComponent(() => import("./routes/changelog"), "ChangelogPage"),
    }),
    createRoute({
      ...child,
      path: "/compare",
      component: lazyRouteComponent(alternatives, "ComparePage"),
    }),
    createRoute({
      ...child,
      path: "/bitly-alternative",
      component: lazyRouteComponent(alternatives, "BitlyAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/rebrandly-alternative",
      component: lazyRouteComponent(alternatives, "RebrandlyAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/dub-alternative",
      component: lazyRouteComponent(alternatives, "DubAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/short-io-alternative",
      component: lazyRouteComponent(alternatives, "ShortIoAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/qr-code-monkey-alternative",
      component: lazyRouteComponent(alternatives, "QrCodeMonkeyAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/tinyurl-alternative",
      component: lazyRouteComponent(alternatives, "TinyUrlAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/docs",
      component: lazyRouteComponent(() => import("./routes/docs"), "DocsPage"),
    }),
    createRoute({
      ...child,
      path: "/privacy",
      component: lazyRouteComponent(() => import("./routes/privacy"), "PrivacyPage"),
    }),
    createRoute({
      ...child,
      path: "/terms",
      component: lazyRouteComponent(() => import("./routes/terms"), "TermsPage"),
    }),
    createRoute({
      ...child,
      path: "/report",
      component: lazyRouteComponent(() => import("./routes/report"), "ReportPage"),
    }),
  ]);
}
