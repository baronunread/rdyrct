/**
 * The visitor's anonymous link, following them down the landing page.
 *
 * Only for somebody who made one: the bar shows their own link and the real
 * time it has left, so the urgency is a fact about their link rather than a
 * sales device. It stays out of the way while the hero card that already
 * shows the link is on screen, and one click hides it for the visit.
 */
import { useEffect, useState } from "react";
import { X } from "../ui/icons";
import { buttonClass } from "../ui/button-class";
import { HrefLink } from "../lib/router-search";
import { trackCta } from "../lib/track-cta";
import { ANON_LINKS_CHANGED, storedAnonLinks, type StoredAnonLink } from "../lib/anon-links";

function timeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/** The newest link this browser made, kept current as the hero makes one. */
function useStoredAnonLink() {
  const [link, setLink] = useState<StoredAnonLink | undefined>(() => storedAnonLinks()[0]);
  useEffect(() => {
    const read = () => setLink(storedAnonLinks()[0]);
    window.addEventListener(ANON_LINKS_CHANGED, read);
    return () => window.removeEventListener(ANON_LINKS_CHANGED, read);
  }, []);
  return link;
}

/** Whether the hero's shortener form is on screen. Signed-in visitors and
 * the other hero arm have no such form, so there is nothing to wait for. */
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

/** The current time, ticking once a second while `ticking`. */
function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}

/** The link to show, or nothing while the hero card shows it or the visitor
 * has hidden the bar. */
function useVisibleLink(hidden: boolean) {
  const link = useStoredAnonLink();
  const heroVisible = useHeroFormVisible();
  return hidden || heroVisible ? undefined : link;
}

/** That link with the time now, ticking, until it expires. */
function useLiveLink(link: StoredAnonLink | undefined) {
  const now = useNow(link !== undefined);
  return link && link.expiresAt > now ? { link, now } : null;
}

export function AnonLinkBar() {
  const [hidden, setHidden] = useState(false);
  const live = useLiveLink(useVisibleLink(hidden));
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
