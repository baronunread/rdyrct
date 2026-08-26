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
 * The page makes no request of its own. The upsell is a plain offer at the
 * end rather than a button that quietly posts somewhere, which is the only
 * version of it that agrees with what the page says about itself.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import * as v from "valibot";
import { ArrowRight, ChevronDown, ShieldCheck } from "@/app/ui/icons";
import { buttonClass } from "../ui/button-class";
import { Input } from "../ui/field";
import { trackCta } from "../lib/track-cta";
import { QRPreview, QrDownloadButtons } from "../components/qr";
import { QrColorAndLogoFields, QrPatternFields } from "../components/qr-fields";
import { qrPreviewProps, resolveLook, type QrValues } from "../lib/qr-look";
import { useSeo } from "../lib/seo";
import { useMarketingScroll } from "../lib/marketing-scroll";
import { FaqJsonLd } from "../components/faq-json-ld";
import { useAudience } from "../lib/audience";
import { LandingHeader } from "../components/landing-header";
import { MarketingLink } from "../components/marketing-link";
import { Footer } from "../ui/footer";
import { registerWebMcpTools, type WebMcpTool } from "../lib/webmcp";
import { QR_CORNER_STYLES, QR_DOT_STYLES } from "@/shared/types";

const hexColor = v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/));
const backgroundColor = v.union([
  v.literal("transparent"),
  v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)),
]);
const generateQrInput = v.object({
  value: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
  dotStyle: v.optional(v.picklist(QR_DOT_STYLES)),
  cornerStyle: v.optional(v.picklist(QR_CORNER_STYLES)),
  dotColor: v.optional(hexColor),
  eyeColor: v.optional(hexColor),
  background: v.optional(backgroundColor),
  logoSize: v.optional(v.picklist([0.25, 0.5, 0.65])),
});
type QrToolInput = v.InferOutput<typeof generateQrInput>;

const qrAppearanceFields = [
  ["dotStyle", "qrStyle"],
  ["cornerStyle", "qrCorner"],
  ["dotColor", "qrColor"],
  ["eyeColor", "qrEyeColor"],
  ["background", "qrBg"],
  ["logoSize", "qrLogoSize"],
] as const;

/** Changes only the appearance values an agent supplied, preserving the rest. */
function qrAppearance(input: QrToolInput): Partial<QrValues> {
  // SAFETY: each tuple pairs a WebMCP input key with a QrValues key, and logoSize is the only numeric input.
  return Object.fromEntries(
    qrAppearanceFields.flatMap(([source, target]) => {
      const value = input[source];
      return value === undefined ? [] : [[target, String(value)]];
    }),
  ) as Partial<QrValues>;
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

/** The code itself, or the space it will occupy. Downloading it belongs to
 * the card's footer, which is there whether or not a code is. */
function CodePanel({ encoded, values }: { encoded: string; values: QrValues }) {
  return (
    <div className="flex flex-col items-center">
      {encoded ? (
        <QRPreview url={encoded} {...qrPreviewProps(values)} />
      ) : (
        <div className="grid h-52 w-52 place-items-center rounded-lg border border-dashed border-border text-center text-xs text-muted">
          Your code appears here
        </div>
      )}
    </div>
  );
}

/**
 * The upsell, kept out of the form and off the network.
 *
 * It used to sit under the input as a dashed box with a button that made an
 * anonymous short link, which put a POST in the middle of a page whose whole
 * claim is that nothing you type leaves the browser. It is a plain offer now:
 * the account is what tracks links, so the offer is the account.
 */
function TrackingSection() {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-dashed border-border p-6 sm:p-8">
      <h2 className="text-lg font-bold">Want to know if anyone scans it?</h2>
      <p className="text-sm text-muted">
        A static code has its destination baked into the dots, so nothing reports back. Point it at
        a short link instead and rdyrct counts every scan by country, device, and time, without
        storing an IP address. Start free and upgrade anytime.
      </p>
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Link
          to="/signup"
          onClick={() => trackCta("qr_page_signup")}
          className={buttonClass({ variant: "primary" })}
        >
          Start free <ArrowRight size={14} />
        </Link>
        <MarketingLink
          to="/pricing"
          onClick={() => trackCta("qr_page_pricing")}
          className="text-sm text-accent hover:underline"
        >
          See Hobby and Pro
        </MarketingLink>
      </div>
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
    a: "A dynamic QR code points at a short link you control, so you can change the destination after it is printed and count the scans. A static code has the destination baked into the dots: it works forever, but it cannot be redirected or measured. To get one, point the code at a short link you own.",
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

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function QrGeneratorPage() {
  // The header has to know: hardcoding "signed out" showed somebody with a
  // session the Log in and Sign up buttons, which then dropped them on the
  // dashboard they were already entitled to.
  const { authed } = useAudience();
  useSeo("/qr-code-generator");
  useMarketingScroll();
  const [value, setValue] = useState("");
  const [values, setValues] = useState<QrValues>(EMPTY_QR);

  useEffect(() => {
    const tools: WebMcpTool[] = [
      {
        name: "generate_qr_code",
        description:
          "Set the value and optional appearance for a QR code in the visible generator. The person can then download it.",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string", minLength: 1, maxLength: 2_000 },
            dotStyle: { type: "string", enum: [...QR_DOT_STYLES] },
            cornerStyle: { type: "string", enum: [...QR_CORNER_STYLES] },
            dotColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
            eyeColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
            background: {
              anyOf: [
                { type: "string", const: "transparent" },
                { type: "string", pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" },
              ],
            },
            logoSize: { type: "number", enum: [0.25, 0.5, 0.65] },
          },
          required: ["value"],
        },
        annotations: { readOnlyHint: false },
        execute: async (input) => {
          const parsed = v.safeParse(generateQrInput, input);
          if (!parsed.success)
            return "That QR value is not valid. Provide non-empty text and try again.";
          setValue(parsed.output.value);
          setValues((current) => ({ ...current, ...qrAppearance(parsed.output) }));
          return "The QR generator now shows that value and appearance. You can download it.";
        },
      },
    ];
    return registerWebMcpTools(tools);
  }, []);

  const setField = <K extends keyof QrValues>(key: K, next: QrValues[K]) =>
    setValues((current) => ({ ...current, [key]: next }));

  const encoded = value.trim();

  return (
    <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
      <LandingHeader authed={authed} />

      <main className="flex flex-col items-center gap-8 py-14 sm:py-20">
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
            <label htmlFor="qr-value" className="text-xs font-medium text-muted">
              Link or text
            </label>
            <Input
              id="qr-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://example.com/spring-sale"
              autoComplete="off"
            />

            {/* The same controls the app uses on a link, in the same order
                the settings card puts them: shapes beside the preview, then
                the colors and the logo across the full width. */}
            <QrPatternFields values={values} setField={setField} isAdmin />
          </div>

          <CodePanel encoded={encoded} values={values} />

          <QrColorAndLogoFields
            values={values}
            setField={setField}
            isAdmin
            localLogo
            className="sm:col-span-2"
          />

          {/* The card's footer: what the page promises on the left, what it
              produces on the right. The downloads live here rather than under
              the code because that row only exists once there is a code, and
              growing it on the first keystroke pushed the whole page down. */}
          <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-accent-2" />
              The code and the logo are handled in your browser. Nothing you type or upload is sent
              anywhere.
            </p>
            <QrDownloadButtons
              url={encoded}
              name="qr"
              look={resolveLook(qrPreviewProps(values))}
              disabled={!encoded}
              // On a phone the two buttons split the card's width and stand a
              // finger tall, rather than being a pair of 8px-tall chips in
              // the corner. Back to their own size once the row is beside the
              // promise it sits with.
              className="shrink-0 [&>button]:h-11 [&>button]:flex-1 [&>button]:text-sm sm:[&>button]:h-8 sm:[&>button]:flex-none sm:[&>button]:text-xs"
            />
          </div>
        </div>

        <TrackingSection />

        <QrFaq />

        <OpenSourceNote />
      </main>

      <Footer />
    </div>
  );
}
