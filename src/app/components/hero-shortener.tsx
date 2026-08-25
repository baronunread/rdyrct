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
import { useState } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { ArrowRight } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { Input } from "../ui/field";
import { CopyButton } from "../ui/copy-button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { useCap } from "../lib/cap";
import {
  MAX_ANON_LINKS,
  rememberAnonLink,
  storedAnonLinks,
  type StoredAnonLink,
} from "../lib/anon-links";
import { shortenAnonymously } from "../lib/shorten-anon";
import { trackCta } from "../lib/track-cta";
import { QRPreview, QrDownloadButtons } from "./qr";

/** The server's own message when it sent one: it says what was wrong with
 * the address, which a generic fallback cannot. */
function shortenErrorMessage(cause: unknown): string {
  return errorMessage(cause, "Could not shorten that link");
}

/** One made link: the URL in the wide column because that is what gets
 * copied, the QR beside it at a size a phone can actually read. */
function MadeLink({ link }: { link: StoredAnonLink }) {
  const toast = useToast();
  return (
    // Top-aligned, and the two columns are built to end at roughly the same
    // line so there is nothing to align around. The download buttons sit
    // under the link rather than under the code: attached to the QR they
    // made that column more than twice the height of this one, and the hole
    // left beside it wanted filler nobody needed.
    // The link arrives rather than appearing: it is the answer to the button
    // that was just pressed, a few hundred milliseconds after it, and a card
    // that pops into the layout reads as a jump rather than as a result.
    <div className="anon-link-in grid grid-cols-[1fr_auto] items-start gap-3 border-t border-dashed border-border pt-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Your short link"
            className="flex min-w-0 flex-1 font-mono text-xs hover:text-accent sm:text-sm"
          >
            {/* The host truncates, never the slug. On a narrow screen, or a
                long custom domain, the slug is the only part that
                identifies the link, so it is the last thing to give up
                width. */}
            <span className="truncate text-muted">
              {link.url.replace(/^https?:\/\//, "").slice(0, -link.slug.length)}
            </span>
            <span className="shrink-0 font-bold">{link.slug}</span>
          </a>
          <CopyButton
            text={link.url}
            label={`Copy ${link.url}`}
            onCopy={(text) => copyToClipboard(text, toast)}
          />
        </div>
        <p className="truncate text-2xs text-muted">from {link.source}</p>
        <QrDownloadButtons url={link.url} name={`qr-${link.slug}`} className="mt-0.5" />
      </div>
      {/* Smaller on a phone so the slug keeps its width: truncating
          "rdyrct.com/m22fs5w" loses exactly the part that identifies it. */}
      <QRPreview url={link.url} sizeClass="size-20 sm:size-26" />
    </div>
  );
}

/** The ask, once, under the link it is about. */
function KeepItFooter() {
  return (
    // A beat behind the link itself, so the eye lands on the short URL first
    // and the ask arrives after it.
    <div className="anon-link-in flex flex-wrap items-center gap-2 border-t border-border pt-3 [animation-delay:70ms]">
      <p className="min-w-52 flex-1 text-xs text-muted">
        This link works for 24 hours. Sign up and it becomes yours permanently, and starts counting
        every click: country, referrer, device, campaign.
      </p>
      <a
        href="/signup"
        onClick={() => trackCta("hero_shortener_claim")}
        className={buttonClass({ variant: "primary", size: "sm" })}
      >
        Keep this link <ArrowRight size={14} />
      </a>
    </div>
  );
}

/** The link, or the reassurance that stands in for it before there is one. */
function MadeLinks({ made }: { made: StoredAnonLink[] }) {
  const link = made[0];
  if (!link)
    return (
      <p className="text-xs text-muted">
        No account, no email. The link lasts 24 hours. Sign up to keep it and start counting clicks.
      </p>
    );
  return (
    <>
      {/* Keyed by slug so a new link is a new element: the animation runs on
          mount, and a re-render for anything else does not replay it. */}
      <MadeLink key={link.slug} link={link} />
      <KeepItFooter />
    </>
  );
}

export function HeroShortener() {
  const toast = useToast();
  const cap = useCap("anon-link");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  // Seeded from storage, so a reload keeps what this browser already made
  // rather than presenting an empty form to somebody who has a link.
  const [made, setMade] = useState<StoredAnonLink[]>(storedAnonLinks);
  const atCap = made.length >= MAX_ANON_LINKS;
  // One reason the button is dead, so the guard and the disabled state can
  // never disagree about it.
  const canSubmit = destination.trim() !== "" && !busy && !atCap;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const link = await shortenAnonymously(destination, cap.guarded);
      // Stored before anything is rendered, and the store decides what the
      // list now is: a visitor who signs up in another tab must still be
      // able to claim it, and the cap is enforced in one place.
      setMade(rememberAnonLink(link, destination.trim()));
      trackCta("hero_shortener");
    } catch (error) {
      toast(shortenErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      // Priming here, not on mount: the proof-of-work runs while they type,
      // and someone who never uses the form never pays for it.
      onInput={cap.prime}
      // No native validation: errors in this app go to toasts, and a browser
      // validity bubble is neither a toast nor dismissible by us. It also
      // silently refuses to submit, which reads as a dead button. The server
      // decides what counts as a web address, and it accepts scheme-less
      // input the same way the signed-in quick-create does.
      noValidate
      className="flex w-full max-w-xl flex-col gap-3 rounded-xl bg-surface p-5 smooth-shadow-ring-sm"
    >
      <label htmlFor="hero-destination" className="text-xs font-medium text-muted">
        Shorten a link, no account needed
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="hero-destination"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://example.com/a-very-long-address"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          // sm:flex-1, not flex-1: this container is a column on phones, so
          // an unqualified flex-1 grows along the vertical axis and lets the
          // field shrink to 20px tall next to a 36px button.
          className="sm:flex-1"
        />
        <Button variant="primary" type="submit" disabled={!canSubmit} className="sm:w-36">
          <BusyContent busy={busy}>Shorten it</BusyContent>
        </Button>
      </div>

      {/* Says why the button is dead, rather than leaving somebody to work
          it out. The footer below already carries the way forward. */}
      {atCap && (
        <p className="text-xs text-muted">
          That is one link, the most this browser can make without an account.
        </p>
      )}

      <MadeLinks made={made} />
    </form>
  );
}
