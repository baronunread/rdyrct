import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { X } from "../ui/icons";
import { buttonClass } from "../ui/button-class";
import { HrefLink } from "../lib/router-search";
import { trackCta } from "../lib/track-cta";
import { clicksLabel, useAnonClicks } from "../lib/shorten-anon";
import {
  anonLinksSnapshot,
  storedAnonLinks,
  subscribeAnonLinks,
  type StoredAnonLink,
} from "../lib/anon-links";

function timeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function useStoredAnonLink() {
  const raw = useSyncExternalStore(subscribeAnonLinks, anonLinksSnapshot, () => null);
  // storedAnonLinks drops expired links; `raw` only tells this to look again.
  return useMemo(() => (raw ? storedAnonLinks()[0] : undefined), [raw]);
}

function useHeroFormVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const form = document.getElementById("hero-destination")?.closest("form");
    if (!form) {
      setVisible(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(form);
    return () => io.disconnect();
  }, []);
  return visible;
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}

function useVisibleLink(hidden: boolean) {
  const link = useStoredAnonLink();
  const heroVisible = useHeroFormVisible();
  return hidden || heroVisible ? undefined : link;
}

function useLiveLink(link: StoredAnonLink | undefined) {
  const now = useNow(link !== undefined);
  return link && link.expiresAt > now ? { link, now } : null;
}

export function AnonLinkBar() {
  const [hidden, setHidden] = useState(false);
  const live = useLiveLink(useVisibleLink(hidden));
  const clicks = useAnonClicks(live?.link);
  if (!live) return null;
  const { link, now } = live;
  return (
    <div
      role="region"
      aria-label="Your short link"
      className="anon-link-in anon-link-bar fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-text py-2 pr-2 pl-4 text-sm text-bg smooth-shadow-ring-2xl"
    >
      <span className="min-w-0 truncate font-mono font-bold">
        {link.url.replace(/^https?:\/\//, "")}
      </span>
      {clicks ? <span className="tnum shrink-0 font-bold">{clicksLabel(clicks)}</span> : null}
      <span className="tnum hidden shrink-0 opacity-80 sm:inline">
        {timeLeft(link.expiresAt - now)} left
      </span>
      <HrefLink
        href="/signup"
        onClick={() => trackCta("anon_link_bar")}
        className={buttonClass({ variant: "primary", size: "sm", className: "shrink-0" })}
      >
        Keep it, free
      </HrefLink>
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label="Hide"
        className="shrink-0 cursor-pointer rounded-md p-1 opacity-70 hover:opacity-100"
      >
        <X size={16} />
      </button>
    </div>
  );
}
