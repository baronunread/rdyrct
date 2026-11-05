import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { configQuery } from "../lib/hooks";
import { readAuthHint } from "../lib/user-cache";
import posthog from "../lib/posthog";
import {
  EXIT_OFFER_MIN_VISIT_MS,
  exitOfferEligible,
  leftTowardTabs,
  readExitOfferMemory,
  rememberExitOfferFinal,
  rememberExitOfferShown,
} from "../lib/exit-offer";

const loadCard = () => import("./exit-offer-card");
const ExitOfferCard = lazy(loadCard);

const DESKTOP_POINTER = "(pointer: fine) and (hover: hover)";

/** Signed in, by either sign this page has: the cached /user (lib/user-cache)
 * or the `data-auth` mark main.tsx sets from it before the first paint. */
const signedIn = () => readAuthHint() || document.documentElement.dataset.auth === "in";

/**
 * Watches for a visitor leaving through the top of the window and shows the
 * exit offer's card once (lib/exit-offer.ts has the rules). Mounted only by
 * the marketing pages' layout (marketing-routes.tsx), which a self-hosted
 * build never bundles, so a fork has no card to show; and only when the
 * deployment runs the offer (`AppConfig.exitOfferCode`).
 */
export function ExitOffer() {
  // Armed once the visitor could be shown the card at all: a mouse, signed
  // out, ten seconds in. Only then does it ask the server whether the offer
  // runs and fetch the card's chunk, so a phone or a signed-in visitor costs
  // nothing.
  const [armed, setArmed] = useState(false);
  const code = useQuery({ ...configQuery, enabled: armed }).data?.exitOfferCode ?? null;
  const enabled = code !== null;
  const [open, setOpen] = useState(false);
  // Mounted from the first show on, so the dialog can play its exit.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const arm = window.setTimeout(() => {
      if (matchMedia(DESKTOP_POINTER).matches && !signedIn()) setArmed(true);
    }, EXIT_OFFER_MIN_VISIT_MS);
    return () => window.clearTimeout(arm);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadCard();
    const onLeave = (event: MouseEvent) => {
      if (!leftTowardTabs(event, window.innerWidth)) return;
      const eligible = exitOfferEligible({
        pathname: location.pathname,
        search: location.search,
        finePointer: matchMedia(DESKTOP_POINTER).matches,
        viewportWidth: window.innerWidth,
        signedIn: signedIn(),
        enabled,
        msOnSite: performance.now(),
        memory: readExitOfferMemory(),
        now: Date.now(),
      });
      if (!eligible) return;
      rememberExitOfferShown();
      posthog.capture("exit_offer_shown", { path: location.pathname });
      setMounted(true);
      setOpen(true);
    };
    document.addEventListener("mouseout", onLeave);
    return () => document.removeEventListener("mouseout", onLeave);
  }, [enabled]);

  if (!mounted || code === null) return null;
  /** The visitor took the offer or turned it down: never again here. */
  const answer = (event: string, props: { how?: string } = {}) => {
    rememberExitOfferFinal();
    posthog.capture(event, { path: location.pathname, ...props });
  };
  return (
    <Suspense fallback={null}>
      <ExitOfferCard
        open={open}
        code={code}
        // The card stays open on "Copied", so the visitor can still read it.
        onCopied={() => answer("exit_offer_code_copied")}
        onAccepted={() => {
          answer("exit_offer_accepted");
          setOpen(false);
        }}
        onDecline={() => {
          answer("exit_offer_dismissed", { how: "no_thanks" });
          setOpen(false);
        }}
        onDismiss={() => {
          posthog.capture("exit_offer_dismissed", { path: location.pathname, how: "closed" });
          setOpen(false);
        }}
      />
    </Suspense>
  );
}
