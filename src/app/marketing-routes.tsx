import { createRoute, Outlet } from "@tanstack/react-router";
import { lazyPage } from "./lib/chunk-guard";
import { LandingHeader } from "./components/landing-header";
import { readAuthHint } from "./lib/user-cache";
import { rootRoute } from "./root-route";

// It rides in the entry chunk so the site's header paints on the first frame. Nothing here
// touches the scroll: this re-renders before the lazy page exists, so a reset here moved the
// page the visitor was leaving (components/marketing-link.tsx, lib/marketing-scroll.ts).
function PublicPages() {
  return <Outlet />;
}

// `pendingMs: 0` so a cold load paints it on the first frame. Safe only because
// a marketing navigation never reaches a pending state: MarketingLink loads the route
// before it commits.
function PublicPagePending() {
  return (
    <div className="page-column">
      <LandingHeader authed={readAuthHint()} />
    </div>
  );
}

// Created in here rather than at the top of the module so that a self-hosted build, which
// never calls it, drops every page and its chunk.
export function marketingRoutes() {
  const page = { pendingComponent: PublicPagePending, pendingMs: 0 };
  const alternatives = () => import("./routes/alternatives");
  const qrTypes = () => import("./routes/qr-types");

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
      path: "/flowcode-alternative",
      component: lazyPage(alternatives, "FlowcodeAlternativePage"),
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
