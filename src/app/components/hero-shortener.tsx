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
import { HrefLink } from "../lib/router-search";
import {
  type BarError,
  HERO_CARD,
  HeroBar,
  HeroFooter,
  HostPrefix,
  MadeLinkPanel,
} from "./hero-link-bar";

function shortenErrorMessage(cause: unknown): string {
  return errorMessage(cause, "Could not shorten that link");
}

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
          <span className="tnum font-bold text-text">{clicksLabel(clicks)} so far.</span> Works for
          24 hours, then someone else can get its address. Sign up to keep it for good and see where
          they came from.
        </>
      ) : (
        "Works for 24 hours, then someone else can get its address. Sign up to keep it for good."
      )}
    </HeroFooter>
  );
}

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
      {/* Keyed by slug so the mount animation does not replay on re-render. */}
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

function useAnonShortener() {
  const toast = useToast();
  const turnstile = useTurnstile("anon-link");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<BarError | null>(null);
  const [made, setMade] = useState<StoredAnonLink[]>([]);
  useEffect(() => setMade(storedAnonLinks()), []);
  const atCap = made.length >= MAX_ANON_LINKS;
  const canSubmit = destination.trim() !== "" && !busy && !atCap;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const link = await shortenAnonymously(destination, turnstile.guarded);
      // Stored before rendering: a visitor who signs up in another tab must still be able to claim it.
      setMade(rememberAnonLink(link, destination.trim()));
      setDestination("");
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
  // This card only exists on rdyrct.com, whose shared host is rdyr.cc until config answers.
  const linkHost = useConfig().data?.linkHost ?? "rdyr.cc";

  return (
    <form
      onSubmit={submit}
      // Prime on input, not mount: the Turnstile challenge runs while they type.
      onInput={prime}
      // No native validation: the browser bubble silently refuses to submit and reads as a dead
      // button. The server decides what a web address is.
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
