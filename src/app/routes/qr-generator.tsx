/**
 * A standalone QR code generator (Direction D of #96).
 *
 * Its own page because "qr code generator" is a thing people search for,
 * and answering that search with a working generator is a better
 * introduction than a pitch. It needs no account and asks for nothing.
 *
 * The upsell is honest and specific rather than a wall: a plain QR code is a
 * dead end, since a printed square cannot tell you it was scanned. Turning it
 * into a short link is what makes it measurable, and that path runs through
 * the same anonymous shortener the hero uses, so it stays free to try.
 */
import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { CopyButton } from "../ui/copy-button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { ApiError } from "../lib/api";
import { useCap } from "../lib/cap";
import { rememberClaim } from "../lib/anon-claim";
import { shortenAnonymously, type AnonLink } from "../lib/shorten-anon";
import { trackCta } from "../lib/track-cta";
import { QRPreview } from "../components/qr";
import { LandingHeader } from "../components/landing-header";
import { Footer } from "../ui/footer";

/** The server's own message when it sent one: it names what was wrong with
 * the address, which a generic fallback cannot. */
function trackErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not make that link trackable";
}

/** The code itself, or the space it will occupy. */
function CodePanel({ encoded }: { encoded: string }) {
  return (
    <div className="flex justify-center sm:justify-start">
      {encoded ? (
        <QRPreview url={encoded} downloadName="qr" />
      ) : (
        <div className="grid h-52 w-52 place-items-center rounded-lg border border-dashed border-border text-center text-xs text-muted">
          Your code appears here
        </div>
      )}
    </div>
  );
}

/** Shown once the code points at a short link that counts scans. */
function TrackedPanel({ tracked }: { tracked: AnonLink }) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
      <div className="flex items-center gap-2 text-xs text-accent-2">
        <Check size={14} /> This code now points at a link that counts scans
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-bold">
          {tracked.url.replace(/^https?:\/\//, "")}
        </span>
        <CopyButton
          text={tracked.url}
          label={`Copy ${tracked.url}`}
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </div>
      <p className="text-xs text-muted">
        Free for 24 hours. Sign up and it is yours for good, with the scans it collects.
      </p>
      <Link to="/signup" onClick={() => trackCta("qr_page_claim")}>
        <Button variant="primary" size="sm">
          Keep this code <ArrowRight size={14} />
        </Button>
      </Link>
    </div>
  );
}

/** The offer, before anyone has taken it: what a plain printed code cannot do. */
function UntrackedPanel({
  busy,
  disabled,
  onTrack,
}: {
  busy: boolean;
  disabled: boolean;
  onTrack: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs text-muted">
        A printed QR code cannot tell you it was scanned. Point this one at a short link and every
        scan is counted, with country, referrer and device.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || disabled}
        onClick={onTrack}
        className="self-start"
      >
        <BusyContent busy={busy}>Count the scans</BusyContent>
      </Button>
    </div>
  );
}

export function QrGeneratorPage() {
  const toast = useToast();
  const cap = useCap("anon-link");
  const [value, setValue] = useState("");
  const [tracked, setTracked] = useState<AnonLink | null>(null);
  const [busy, setBusy] = useState(false);

  // Everything after this point encodes one string: either what they typed,
  // or the short link they turned it into.
  const encoded = tracked?.url ?? value.trim();

  const makeTrackable = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const result = await shortenAnonymously(value, cap.headers);
      rememberClaim(result.claimToken);
      setTracked(result);
      trackCta("qr_page_trackable");
    } catch (error) {
      toast(trackErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
      <LandingHeader authed={false} />

      <section className="flex flex-col items-center gap-8 py-14 sm:py-20">
        <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Free QR code generator
          </h1>
          <p className="text-sm text-muted sm:text-base">
            Type anything, download the code. No account, no watermark, no expiry on the image, and
            nothing about you is stored.
          </p>
        </div>

        <div className="grid w-full max-w-3xl gap-6 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-3">
            <label htmlFor="qr-value" className="text-2xs tracking-wider text-muted uppercase">
              Link or text
            </label>
            <Input
              id="qr-value"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                // A new value makes the old short link the wrong answer.
                setTracked(null);
              }}
              onInput={cap.prime}
              placeholder="https://example.com/spring-sale"
              autoComplete="off"
            />

            {tracked ? (
              <TrackedPanel tracked={tracked} />
            ) : (
              <UntrackedPanel busy={busy} disabled={!value.trim()} onTrack={makeTrackable} />
            )}

            <p className="flex items-center gap-1.5 text-xs text-muted">
              <ShieldCheck size={13} className="text-accent-2" />
              The code is drawn in your browser. Nothing you type is sent anywhere.
            </p>
          </div>

          <CodePanel encoded={encoded} />
        </div>

        <div className="max-w-2xl text-center">
          <p className="text-sm text-muted">
            Want your logo in the middle, your colors, and your own domain on the link?{" "}
            <Link
              to="/signup"
              className="text-accent hover:underline"
              onClick={() => trackCta("qr_page_branding")}
            >
              That comes with a paid plan
            </Link>
            .
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
