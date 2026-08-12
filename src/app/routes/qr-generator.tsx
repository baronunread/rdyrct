/**
 * A standalone QR code generator (Direction D of #96).
 *
 * Its own page because "qr code generator" is a thing people search for, and
 * answering that search with a working generator is a better introduction
 * than a pitch. It needs no account and asks for nothing.
 *
 * It is the same form the app uses to style a link's QR code, minus the
 * parts that need an account: no domain, no slug, no saving. Same controls,
 * same preview, same downloads, and the logo stays in the browser as a data
 * URL rather than going to a bucket. Giving the whole thing away costs
 * nothing, because none of it runs on a server: what rdyrct sells is what a
 * printed square cannot do on its own, which is tell you it was scanned.
 *
 * The upsell is honest and specific rather than a wall: turning the code
 * into a short link is what makes it measurable, and that path runs through
 * the same anonymous shortener the hero uses, so it stays free to try.
 */
import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { CopyButton } from "../ui/copy-button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { ApiError } from "../lib/api";
import { useCap } from "../lib/cap";
import { MAX_ANON_LINKS, rememberAnonLink, storedAnonLinks } from "../lib/anon-links";
import { shortenAnonymously, type AnonLink } from "../lib/shorten-anon";
import { trackCta } from "../lib/track-cta";
import { QRPreview } from "../components/qr";
import { QrColorAndLogoFields, QrShapeFields } from "../components/qr-fields";
import { qrPreviewProps, type QrValues } from "../lib/qr-look";
import { useSeo } from "../lib/seo";
import { FaqJsonLd } from "../components/faq-json-ld";
import { useAudience } from "../lib/audience";
import { LandingHeader } from "../components/landing-header";
import { Footer } from "../ui/footer";

/** The server's own message when it sent one: it names what was wrong with
 * the address, which a generic fallback cannot. */
function trackErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not make that link trackable";
}

const EMPTY_QR: QrValues = {
  qrStyle: "",
  qrColor: "",
  qrLogo: "",
  qrCorner: "",
  qrBg: "",
  qrEyeColor: "",
  qrLogoSize: "",
};

/** The code itself, or the space it will occupy. */
function CodePanel({ encoded, values }: { encoded: string; values: QrValues }) {
  return (
    <div className="flex flex-col items-center gap-3">
      {encoded ? (
        <QRPreview url={encoded} downloadName="qr" {...qrPreviewProps(values)} />
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
    <div className="flex max-w-md flex-col gap-2 rounded-lg bg-surface-2 p-3">
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

/** The offer, before anyone has taken it. */
function UntrackedPanel({
  busy,
  disabled,
  atCap,
  onTrack,
}: {
  busy: boolean;
  disabled: boolean;
  /** The same three-link ceiling the hero has: both go through the one
   * anonymous shortener, so one browser cannot get six by using both. */
  atCap: boolean;
  onTrack: () => void;
}) {
  if (atCap)
    return (
      <p className="text-sm text-muted">
        This browser has already made {MAX_ANON_LINKS} links without an account.{" "}
        <Link to="/signup" onClick={() => trackCta("qr_page_claim")} className="text-accent">
          Sign up
        </Link>{" "}
        to make more, and to keep the ones you have.
      </p>
    );
  return (
    <Button variant="outline" disabled={busy || disabled} onClick={onTrack} className="self-start">
      <BusyContent busy={busy}>Give it a short link</BusyContent>
    </Button>
  );
}

/**
 * The upsell, kept out of the form.
 *
 * It used to sit under the input as a dashed box with its own paragraph and
 * button, in the middle of the controls that draw the code. That made the
 * thing somebody came here to use read like a step in a sales pitch. The form
 * does one job now, and the offer comes after it.
 */
function TrackingSection({
  tracked,
  ...offer
}: {
  tracked: AnonLink | null;
  busy: boolean;
  disabled: boolean;
  atCap: boolean;
  onTrack: () => void;
}) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-dashed border-border p-6 sm:p-8">
      <h2 className="text-lg font-bold">Nothing comes back from a printed code</h2>
      <p className="text-sm text-muted">
        The address is in the dots, so a scan leaves no trace. A short link in the middle fixes
        that: you get the count, the country and the device. It costs you one redirect on the way
        through.
      </p>
      {tracked ? <TrackedPanel tracked={tracked} /> : <UntrackedPanel {...offer} />}
    </section>
  );
}

/**
 * What the tool is built on, and why it is free.
 *
 * Named libraries rather than a vague nod at open source: anyone weighing a
 * generator that draws codes in their browser deserves to know which code is
 * doing the drawing, and the people who wrote it deserve the credit.
 */
function OpenSourceNote() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 border-t border-border pt-8 text-sm text-muted">
      <h2 className="text-sm font-bold text-text">Free, and built on free things</h2>
      <p>
        The codes here are drawn by{" "}
        <a
          href="https://github.com/kozakdenys/qr-code-styling"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent hover:underline"
        >
          qr-code-styling
        </a>
        , the logos are cleaned up with{" "}
        <a
          href="https://github.com/svg/svgo"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent hover:underline"
        >
          SVGO
        </a>{" "}
        and{" "}
        <a
          href="https://github.com/Donaldcwl/browser-image-compression"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent hover:underline"
        >
          browser-image-compression
        </a>
        , and the page itself is React and Tailwind. All of it open source, all of it doing the work
        on your machine.
      </p>
      <p>
        We think tools like this should be free as in beer and open as in source. A QR code is a
        square of dots: nobody should pay a subscription to draw one, and nobody should have to hand
        over an email address for a PNG.
      </p>
      <p>
        rdyrct, the team-based link and QR analytics behind this page, is how the work gets paid
        for. It exists so this generator can stay free, and so the businesses using it can see which
        poster, flyer or shop window actually brought people in. If that is useful to you,{" "}
        <Link to="/signup" className="text-accent hover:underline">
          it starts free too
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * What people type into a search box before they land here, answered on the
 * page rather than in a blog post. The same list feeds the FAQPage data, so
 * the answers a result shows are the answers the page shows.
 */
const qrFaqs = [
  {
    q: "Is this QR code generator really free?",
    a: "Yes. No account, no watermark on the image, no expiry, and no limit on how many codes you make. The code is drawn in your browser, so it costs us nothing to give away.",
  },
  {
    q: "Can I put my logo in the middle of a QR code?",
    a: "Yes. Drop in a PNG, JPG or SVG and choose how much of the code it covers. The image is prepared in your browser and never uploaded. Keep the logo small and square if the code has to scan from a distance.",
  },
  {
    q: "PNG or SVG?",
    a: "SVG for anything printed: it stays sharp at any size, which matters on posters, packaging and vehicle livery. PNG for screens, email and slides.",
  },
  {
    q: "What is a dynamic QR code, and do I need one?",
    a: "A dynamic QR code points at a short link you control, so you can change the destination after it is printed and count the scans. A static code has the destination baked into the dots: it works forever, but it cannot be redirected or measured. Use the button above to turn this one into a trackable link.",
  },
  {
    q: "Do QR codes expire?",
    a: "The image never does. What can expire is whatever it points at, which is the argument for pointing it at a short link you own rather than at a URL somebody else controls.",
  },
];

/**
 * w-full matters here: the section centers its children, so without a width
 * of its own this column sizes to its content, and every answer that opens is
 * wider than the question it hangs under. The list changed width on every
 * click.
 */
function QrFaq() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <h2 className="text-sm font-bold">QR code questions</h2>
      {qrFaqs.map(({ q, a }) => (
        <details
          key={q}
          className="group rounded-lg border border-border bg-surface px-4 open:border-accent/40"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-bold [&::-webkit-details-marker]:hidden">
            {q}
            <ChevronDown
              size={16}
              className="shrink-0 text-muted transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="pb-4 text-sm text-muted">{a}</p>
        </details>
      ))}
      <FaqJsonLd faqs={qrFaqs} />
    </div>
  );
}

export function QrGeneratorPage() {
  // The header has to know: hardcoding "signed out" showed somebody with a
  // session the Log in and Sign up buttons, which then dropped them on the
  // dashboard they were already entitled to.
  const { authed } = useAudience();
  useSeo("/qr-code-generator");
  const toast = useToast();
  const cap = useCap("anon-link");
  const [value, setValue] = useState("");
  const [values, setValues] = useState<QrValues>(EMPTY_QR);
  const [tracked, setTracked] = useState<AnonLink | null>(null);
  const [busy, setBusy] = useState(false);

  const setField = <K extends keyof QrValues>(key: K, next: QrValues[K]) =>
    setValues((current) => ({ ...current, [key]: next }));

  // Everything after this point encodes one string: either what they typed,
  // or the short link they turned it into.
  const encoded = tracked?.url ?? value.trim();

  const makeTrackable = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const result = await shortenAnonymously(value, cap.guarded);
      rememberAnonLink(result, value.trim());
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
      <LandingHeader authed={authed} />

      <section className="flex flex-col items-center gap-8 py-14 sm:py-20">
        <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Free QR code generator
          </h1>
          <p className="text-sm text-muted sm:text-base">
            A free QR code maker for links, text, Wi-Fi details or anything else you can put in a
            string. Add your logo, pick your colors and dot style, and download a PNG or an SVG. No
            account, no watermark, no expiry on the image, and nothing about you is stored.
          </p>
        </div>

        <div className="grid w-full max-w-3xl gap-6 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-[1fr_auto] sm:p-8">
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

            {/* The same controls the app uses on a link, in the same order
                the settings card puts them: shapes beside the preview, then
                the colors and the logo across the full width. */}
            <QrShapeFields values={values} setField={setField} isAdmin />
          </div>

          <CodePanel encoded={encoded} values={values} />

          <QrColorAndLogoFields
            values={values}
            setField={setField}
            isAdmin
            localLogo
            className="sm:col-span-2"
          />

          <p className="flex items-center gap-1.5 text-xs text-muted sm:col-span-2">
            <ShieldCheck size={13} className="text-accent-2" />
            The code and the logo are handled in your browser. Nothing you type or upload is sent
            anywhere.
          </p>
        </div>

        <TrackingSection
          tracked={tracked}
          busy={busy}
          disabled={!value.trim()}
          atCap={storedAnonLinks().length >= MAX_ANON_LINKS}
          onTrack={makeTrackable}
        />

        <QrFaq />

        <OpenSourceNote />
      </section>

      <Footer />
    </div>
  );
}
