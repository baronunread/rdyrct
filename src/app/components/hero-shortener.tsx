/**
 * The anonymous shortener in the hero (Direction A of #96).
 *
 * This replaced a 470-line animated mockup of the product. The mockup was a
 * picture of a thing working; this is the thing working. Somebody can paste a
 * link, get a real short URL back, and only then decide whether an account is
 * worth it.
 *
 * The link lasts 24 hours. Signing up keeps it: the claim token goes to
 * localStorage and the app spends it once the new account has an org, so the
 * first dashboard is not empty (#65).
 */
import { useState } from "react";
import { ArrowRight, Check, QrCode } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { CopyButton } from "../ui/copy-button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { api, ApiError } from "../lib/api";
import { useCap } from "../lib/cap";
import { rememberClaim } from "../lib/anon-claim";
import { trackCta } from "../lib/track-cta";
import { QRPreview } from "./qr";

type Shortened = { slug: string; url: string; claimToken: string; expiresAt: number };

/** The server's own message when it sent one: it says what was wrong with
 * the address, which a generic fallback cannot. */
function shortenErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not shorten that link";
}

/** One call, carrying the proof of work solved while the visitor typed (#98). */
async function shortenAnonymously(
  destination: string,
  capHeaders: () => Promise<Record<string, string>>,
): Promise<Shortened> {
  return api<Shortened>("/shorten", {
    method: "POST",
    body: { destination, capToken: (await capHeaders())["x-cap-token"] ?? "" },
  });
}

export function HeroShortener() {
  const toast = useToast();
  const cap = useCap("anon-link");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Shortened | null>(null);
  const [showQr, setShowQr] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!destination.trim() || busy) return;
    setBusy(true);
    try {
      const shortened = await shortenAnonymously(destination, cap.headers);
      // Written down before anything is rendered: a visitor who signs up in
      // another tab must still be able to claim it.
      rememberClaim(shortened.claimToken);
      setResult(shortened);
      trackCta("hero_shortener");
    } catch (error) {
      toast(shortenErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-xl bg-surface p-5 smooth-shadow-ring-sm">
        <div className="flex items-center gap-2 text-xs text-accent-2">
          <Check size={14} /> Your link is live
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Your short link"
            className="min-w-0 flex-1 truncate font-mono text-sm font-bold hover:text-accent"
          >
            {result.url.replace(/^https?:\/\//, "")}
          </a>
          <CopyButton
            text={result.url}
            label={`Copy ${result.url}`}
            onCopy={(text) => copyToClipboard(text, toast)}
          />
        </div>

        {showQr ? (
          <div className="flex justify-center">
            <QRPreview url={result.url} downloadName={`qr-${result.slug}`} />
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setShowQr(true)} className="self-start">
            <QrCode size={14} /> Show the QR code
          </Button>
        )}

        <p className="text-xs text-muted">
          This link works for 24 hours and records nothing. Sign up and it becomes yours
          permanently, with the clicks it earns.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/signup" onClick={() => trackCta("hero_shortener_claim")}>
            <Button variant="primary" size="sm">
              Keep this link <ArrowRight size={14} />
            </Button>
          </a>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setResult(null);
              setShowQr(false);
              setDestination("");
            }}
          >
            Shorten another
          </Button>
        </div>
      </div>
    );
  }

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
        <Button variant="primary" type="submit" disabled={busy} className="sm:w-36">
          <BusyContent busy={busy}>Shorten it</BusyContent>
        </Button>
      </div>
      <p className="text-xs text-muted">
        No account, no email. The link lasts 24 hours, and you can keep it later.
      </p>
    </form>
  );
}
