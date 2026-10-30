/**
 * The anonymous shortener in the hero (Direction A of #96).
 *
 * This replaced a 470-line animated mockup of the product. The mockup was a
 * picture of a thing working; this is the thing working. Somebody can paste a
 * link, get a real short URL back, and only then decide whether an account is
 * worth it.
 *
 * The form never swaps out. One link opens underneath it, directly under the
 * button that was pressed, and that is the ceiling without an account: the
 * second link is the point where trying it becomes signing up.
 *
 * The link lasts 24 hours. Signing up keeps it: the claim token goes to
 * localStorage and the app spends it once the new account has an org, so the
 * first dashboard is not empty (#65).
 */
import { useEffect, useState } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { ApiError } from "@/app/lib/api";
import { TURNSTILE_FAILED_CODE } from "@/shared/types";
import { ArrowRight } from "@/app/ui/icons";
import { buttonClass } from "../ui/button-class";
import { useToast } from "../ui/toast";
import { guardedButton, useTurnstile } from "../lib/turnstile";
import { TurnstileSlot } from "./turnstile-slot";
import { useConfig } from "../lib/hooks";
import {
  MAX_ANON_LINKS,
  rememberAnonLink,
  storedAnonLinks,
  type StoredAnonLink,
} from "../lib/anon-links";
import { clicksLabel, shortenAnonymously, useAnonClicks } from "../lib/shorten-anon";
import { trackCta } from "../lib/track-cta";
import { launchHeroHop } from "../lib/hero-hop";
import { HrefLink } from "../lib/router-search";
import {
  type BarError,
  HERO_CARD,
  HeroBar,
  HeroFooter,
  HostPrefix,
  MadeLinkPanel,
} from "./hero-link-bar";

/** The server's own message when it sent one: it says what was wrong with
 * the address, which a generic fallback cannot. */
function shortenErrorMessage(cause: unknown): string {
  return errorMessage(cause, "Could not shorten that link");
}

/** A 400 is the server refusing the address itself (not a web address, a
 * blocked host, another shortener), so it marks the bar; anything else
 * (rate limit, outage) has no field to mark and stays a toast. */
function refusedAddress(cause: unknown): BarError | null {
  if (!isRefusal(cause)) return null;
  const detail = cause.message;
  return {
    reason: /web address/i.test(detail) ? "Not a web address" : "Can't shorten this",
    detail,
  };
}

const isRefusal = (cause: unknown): cause is ApiError =>
  cause instanceof ApiError && cause.status === 400 && cause.code !== TURNSTILE_FAILED_CODE;

/** The ask, once, under the link it is about. Once the link has been
 * clicked, the count leads: it is the visitor's own result, and "see where
 * they came from" is what the account adds to it. */
function KeepItFooter({ link }: { link: StoredAnonLink }) {
  const clicks = useAnonClicks(link);
  return (
    <HeroFooter
      ruled
      action={
        <HrefLink
          href="/signup"
          onClick={() => trackCta("hero_shortener_claim")}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          Keep this link <ArrowRight size={14} />
        </HrefLink>
      }
    >
      {clicks ? (
        <>
          <span className="tnum font-bold text-text">{clicksLabel(clicks)} so far.</span> Sign up to
          keep this link and see where they came from.
        </>
      ) : (
        "Works for 24 hours. Sign up to keep it and see where its clicks come from."
      )}
    </HeroFooter>
  );
}

/** The link and the ask under it, or the reassurance that stands in for
 *  them before there is one. */
function MadeLinks({ made }: { made: StoredAnonLink[] }) {
  const link = made[0];
  if (!link)
    return (
      <HeroFooter
        action={
          <HrefLink
            href="/signup"
            onClick={() => trackCta("hero_shortener_signup")}
            className="inline-flex shrink-0 items-center gap-1 hover:text-text"
          >
            Sign up free <ArrowRight size={13} />
          </HrefLink>
        }
      >
        No account needed. The link lasts 24 hours.
      </HeroFooter>
    );
  return (
    <>
      {/* Keyed by slug so a new link is a new element: the animation runs on
          mount, and a re-render for anything else does not replay it. */}
      <MadeLinkPanel
        key={link.slug}
        url={link.url}
        slug={link.slug}
        detail={`from ${link.source}`}
      />
      <KeepItFooter link={link} />
    </>
  );
}

/** The form's state and what pressing the button does: make the link,
 *  remember it for the claim after sign-up, and launch it across the globe. */
function useAnonShortener() {
  const toast = useToast();
  const turnstile = useTurnstile("anon-link");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<BarError | null>(null);
  // Seeded from storage, so a reload keeps what this browser already made
  // rather than presenting an empty form to somebody who has a link.
  const [made, setMade] = useState<StoredAnonLink[]>([]);
  useEffect(() => setMade(storedAnonLinks()), []);
  const atCap = made.length >= MAX_ANON_LINKS;
  // One reason the button is dead, so the guard and the disabled state can
  // never disagree about it.
  const canSubmit = destination.trim() !== "" && !busy && !atCap;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const link = await shortenAnonymously(destination, turnstile.guarded);
      // Stored before anything is rendered, and the store decides what the
      // list now is: a visitor who signs up in another tab must still be
      // able to claim it, and the cap is enforced in one place.
      setMade(rememberAnonLink(link, destination.trim()));
      setDestination("");
      launchHeroHop(link.url.replace(/^https?:\/\//, ""));
      trackCta("hero_shortener");
    } catch (error) {
      const mark = refusedAddress(error);
      if (mark) setRefused(mark);
      else toast(shortenErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return {
    destination,
    setDestination: (value: string) => {
      setDestination(value);
      setRefused(null);
    },
    refused,
    busy,
    made,
    canSubmit,
    submit,
    prime: turnstile.prime,
    challenge: turnstile.challenge,
    button: guardedButton(busy, turnstile.challenge),
  };
}

export function HeroShortener() {
  const {
    destination,
    setDestination,
    refused,
    button,
    made,
    canSubmit,
    submit,
    prime,
    challenge,
  } = useAnonShortener();
  // The shared domain the slug will follow. This card only exists on
  // rdyrct.com, whose shared host is rdyr.cc, so that stands in until the
  // config answers.
  const linkHost = useConfig().data?.linkHost ?? "rdyr.cc";

  return (
    <form
      onSubmit={submit}
      // Priming here, not on mount: the Turnstile challenge runs while they type,
      // and someone who never uses the form never pays for it.
      onInput={prime}
      // No native validation: a refused address marks the bar, and a browser
      // validity bubble is neither that nor dismissible by us. It also
      // silently refuses to submit, which reads as a dead button. The server
      // decides what counts as a web address, and it accepts scheme-less
      // input the same way the signed-in quick-create does.
      noValidate
      className={HERO_CARD}
    >
      <TurnstileSlot challenge={challenge} className="mb-2 rounded-xl" />
      <HeroBar
        prefix={<HostPrefix host={linkHost} />}
        input={{
          id: "hero-destination",
          "aria-label": "Shorten a link, no account needed",
          value: destination,
          onChange: (e) => setDestination(e.target.value),
        }}
        disabled={!canSubmit}
        busy={button.spinning}
        waiting={button.waiting}
        again={made.length > 0}
        error={refused}
      />

      <MadeLinks made={made} />
    </form>
  );
}
