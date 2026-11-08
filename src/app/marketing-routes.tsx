import { createRoute, Outlet } from "@tanstack/react-router";
import { lazyPage } from "./lib/chunk-guard";
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
 * The router loads that chunk itself now (lazyPage below), so
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
  const qrTypes = () => import("./routes/qr-types");

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
      component: lazyPage(() => import("./routes/landing"), "LandingPage"),
    }),
    createRoute({
      ...child,
      path: "/qr-code-generator",
      component: lazyPage(() => import("./routes/qr-generator"), "QrGeneratorPage"),
    }),
    createRoute({
      ...child,
      path: "/utm-builder",
      component: lazyPage(() => import("./routes/utm-builder"), "UtmBuilderPage"),
    }),
    createRoute({
      ...child,
      path: "/branded-link-shortener",
      component: lazyPage(
        () => import("./routes/branded-link-shortener"),
        "BrandedLinkShortenerPage",
      ),
    }),
    createRoute({
      ...child,
      path: "/pricing",
      component: lazyPage(() => import("./routes/pricing"), "PricingPage"),
    }),
    createRoute({
      ...child,
      path: "/roadmap",
      component: lazyPage(() => import("./routes/roadmap"), "RoadmapPage"),
    }),
    createRoute({
      ...child,
      path: "/changelog",
      component: lazyPage(() => import("./routes/changelog"), "ChangelogPage"),
    }),
    createRoute({
      ...child,
      path: "/compare",
      component: lazyPage(alternatives, "ComparePage"),
    }),
    createRoute({
      ...child,
      path: "/bitly-alternative",
      component: lazyPage(alternatives, "BitlyAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/rebrandly-alternative",
      component: lazyPage(alternatives, "RebrandlyAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/dub-alternative",
      component: lazyPage(alternatives, "DubAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/short-io-alternative",
      component: lazyPage(alternatives, "ShortIoAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/google-url-shortener",
      component: lazyPage(() => import("./routes/google-url-shortener"), "GoogleUrlShortenerPage"),
    }),
    createRoute({
      ...child,
      path: "/whatsapp-qr-code",
      component: lazyPage(qrTypes, "WhatsappQrPage"),
    }),
    createRoute({
      ...child,
      path: "/vcard-qr-code",
      component: lazyPage(qrTypes, "VcardQrPage"),
    }),
    createRoute({
      ...child,
      path: "/wifi-qr-code",
      component: lazyPage(qrTypes, "WifiQrPage"),
    }),
    createRoute({
      ...child,
      path: "/qr-code-monkey-alternative",
      component: lazyPage(alternatives, "QrCodeMonkeyAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/tinyurl-alternative",
      component: lazyPage(alternatives, "TinyUrlAlternativePage"),
    }),
    createRoute({
      ...child,
      path: "/docs",
      component: lazyPage(() => import("./routes/docs"), "DocsPage"),
    }),
    createRoute({
      ...child,
      path: "/privacy",
      component: lazyPage(() => import("./routes/privacy"), "PrivacyPage"),
    }),
    createRoute({
      ...child,
      path: "/terms",
      component: lazyPage(() => import("./routes/terms"), "TermsPage"),
    }),
    createRoute({
      ...child,
      path: "/report",
      component: lazyPage(() => import("./routes/report"), "ReportPage"),
    }),
  ]);
}
