/**
 * The anonymous shortener in the hero (Direction A of #96).
 *
 * This replaced a 470-line animated mockup of the product. The mockup was a
 * picture of a thing working; this is the thing working. Somebody can paste a
 * link, get a real short URL back, and only then decide whether an account is
 * worth it.
 *
 * The form never swaps out. Results open underneath it and stack, newest
 * first, so the link you just made is always directly under the button you
 * pressed and a link already on screen never changes again. There is no
 * "shorten another" control: the input stays filled, the button stays live,
 * and typing a new address is the whole gesture.
 *
 * How tall this can get is bounded by the rate limit rather than by taste:
 * RL_ANON_LINK allows five links a minute from one address, so the realistic
 * worst case is a handful of rows.
 *
 * The links last 24 hours. Signing up keeps them: each claim token goes to
 * localStorage and the app spends it once the new account has an org, so the
 * first dashboard is not empty (#65).
 */
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { CopyButton } from "../ui/copy-button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { ApiError } from "../lib/api";
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
function shortenErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not shorten that link";
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
    <div className="grid gap-3 border-t border-dashed border-border pt-3 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Your short link"
            className="min-w-0 flex-1 truncate font-mono text-sm font-bold hover:text-accent"
          >
            {link.url.replace(/^https?:\/\//, "")}
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
      <div className="justify-self-center sm:justify-self-auto">
        <QRPreview url={link.url} size={104} />
      </div>
    </div>
  );
}

/** Written out per case rather than assembled from fragments: a sentence
 * stitched together from four inline conditionals is unreadable in source
 * and easy to break in one of its halves. */
function keepCopy(count: number): { body: string; action: string } {
  if (count === 1)
    return {
      body: "This link works for 24 hours and records nothing. Sign up and it becomes yours permanently, with the clicks it earns.",
      action: "Keep this link",
    };
  return {
    body: `These ${count} links work for 24 hours and record nothing. Sign up and they become yours permanently, with the clicks they earn.`,
    action: "Keep them",
  };
}

/** One ask for all of them: repeating it per row would turn a useful card
 * into a nag, and "keep these 3 links" is a better ask than three separate
 * "keep this link". */
function KeepThemFooter({ count }: { count: number }) {
  const copy = keepCopy(count);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <p className="min-w-52 flex-1 text-xs text-muted">{copy.body}</p>
      <a href="/signup" onClick={() => trackCta("hero_shortener_claim")}>
        <Button variant="primary" size="sm">
          {copy.action} <ArrowRight size={14} />
        </Button>
      </a>
    </div>
  );
}

/** The stack, or the reassurance that stands in for it before there is one. */
function MadeLinks({ made }: { made: StoredAnonLink[] }) {
  if (made.length === 0)
    return (
      <p className="text-xs text-muted">
        No account, no email. Links last 24 hours, and you can keep them later.
      </p>
    );
  return (
    <>
      {made.map((link) => (
        <MadeLink key={link.slug} link={link} />
      ))}
      <KeepThemFooter count={made.length} />
    </>
  );
}

export function HeroShortener() {
  const toast = useToast();
  const cap = useCap("anon-link");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  // Seeded from storage, so a reload keeps what this browser already made
  // rather than presenting an empty form to somebody who has three links.
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
      const link = await shortenAnonymously(destination, cap.headers);
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
      <label htmlFor="hero-destination" className="text-2xs tracking-wider text-muted uppercase">
        Try it without an account
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
          className="flex-1"
        />
        <Button variant="primary" type="submit" disabled={!canSubmit} className="sm:w-36">
          <BusyContent busy={busy}>Shorten it</BusyContent>
        </Button>
      </div>

      {/* Says why the button is dead, rather than leaving somebody to work
          it out. The footer below already carries the way forward. */}
      {atCap && (
        <p className="text-xs text-muted">
          That is {MAX_ANON_LINKS} links, the most this browser can make without an account.
        </p>
      )}

      <MadeLinks made={made} />
    </form>
  );
}
