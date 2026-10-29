/**
 * The pieces both hero cards are built from, the anonymous shortener and the
 * signed-in quick create: one field with a prefix that says where the link
 * goes (the shared domain for a stranger, the organization for an account),
 * and, once a link is made, the panel that opens under it with the link to
 * copy, its downloads and its QR code. Shared so signing in swaps the prefix
 * and the footer and nothing else.
 */
import {
  lazy,
  Suspense,
  type ComponentProps,
  type ComponentType,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  useId,
} from "react";
import { Button } from "../ui/button";
import { FieldReason, invalidAria } from "../ui/field";
import { CopyButton } from "../ui/copy-button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { CHALLENGE_LABEL } from "../lib/turnstile";
import { cn } from "../ui/cn";

// A QR code is useful only once a link exists. Keeping the renderer behind
// that state avoids loading its encoder for everyone who only reads the page.
// A failed load (usually a stale tab after a deploy) shows no QR rather than
// reaching the error boundary.
type Qr = typeof import("./qr");
const loadQr = () => import("./qr").catch(() => null);
const QRPreview = lazy(
  async (): Promise<{ default: ComponentType<ComponentProps<Qr["QRPreview"]>> }> => ({
    default: (await loadQr())?.QRPreview ?? NoQr,
  }),
);
const QrDownloadButtons = lazy(
  async (): Promise<{ default: ComponentType<ComponentProps<Qr["QrDownloadButtons"]>> }> => ({
    default: (await loadQr())?.QrDownloadButtons ?? NoQr,
  }),
);
function NoQr() {
  return null;
}

/** The card both heroes sit in: a frame around the bar and what follows. */
export const HERO_CARD =
  "w-full max-w-xl rounded-2xl bg-surface p-2 text-left smooth-shadow-ring-sm";

/**
 * The field, its prefix and the button in one bordered line, like a
 * launcher. The input carries no border of its own: the bar is the field.
 * On a phone the button drops under the field rather than squeezing it.
 */
export function HeroBar({
  prefix,
  input,
  inputRef,
  disabled,
  busy,
  title,
  again = false,
  waiting = false,
  error,
}: {
  prefix: ReactNode;
  input: InputHTMLAttributes<HTMLInputElement>;
  inputRef?: Ref<HTMLInputElement>;
  disabled: boolean;
  busy: boolean;
  /** Why the button is dead, when it is for a reason other than an empty field. */
  title?: string;
  /** A link has been made already, so the field asks for the next one. */
  again?: boolean;
  /** A submission waits on the Turnstile challenge above the bar; `busy`
   * is then false, since the button says so instead of spinning. */
  waiting?: boolean;
  /** Why the address was refused: the bar turns danger and the reason sits
   * at the end of the field, so nothing under the bar moves. */
  error?: BarError | null;
}) {
  const reasonId = useId();
  const invalid = invalidAria(error?.reason, reasonId);
  return (
    // The marked input turns the bar danger: the state lives on the input.
    <div className="group/bar flex flex-col gap-2 rounded-xl border border-border bg-bg p-1 focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)] has-[[aria-invalid=true]]:border-danger has-[[aria-invalid=true]]:focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_18%,transparent)] sm:flex-row sm:items-center sm:gap-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
        {/* On a phone the prefix steps aside while the field is marked, so
            the reason and what was typed both keep room. */}
        <span className="contents group-has-[[aria-invalid=true]]/bar:max-sm:hidden">{prefix}</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={again ? "Paste another…" : "Paste a long link…"}
          {...input}
          {...invalid}
          // The bar draws the focus ring, so the field drops the global one
          // (unlayered in styles.css, hence the !).
          className="h-9 min-w-0 flex-1 bg-transparent px-1 text-base text-text outline-none! placeholder:text-placeholder sm:text-sm"
        />
        {error && <BarReason id={reasonId} error={error} />}
      </div>
      <Button
        variant="primary"
        type="submit"
        disabled={disabled}
        title={title}
        className="h-9 rounded-lg sm:w-auto"
      >
        <BusyContent busy={busy}>
          <ShortenLabel waiting={waiting} />
        </BusyContent>
      </Button>
    </div>
  );
}

/** What was wrong with the address: a few words, and the server's whole
 * sentence for screen readers and on hover. */
export type BarError = { reason: string; detail: string };

function BarReason({ id, error }: { id: string; error: BarError }) {
  return (
    <span className="max-w-[45%] shrink-0 pr-1.5 text-xs">
      <FieldReason id={id} reason={error.reason} detail={error.detail} />
    </span>
  );
}

/** "Shorten it" with its Enter hint, or what is left to do while a
 * submission waits on the Turnstile challenge. */
function ShortenLabel({ waiting }: { waiting: boolean }) {
  if (waiting) return CHALLENGE_LABEL;
  return (
    <>
      Shorten it
      <kbd
        aria-hidden="true"
        className="ml-1 hidden rounded border border-current/30 border-b-2 px-1 font-mono text-[0.6875rem] font-normal opacity-70 sm:inline"
      >
        ↵
      </kbd>
    </>
  );
}

/** The shared domain as the bar's prefix: what the slug will follow. */
export function HostPrefix({ host }: { host: string }) {
  return (
    <span className="shrink-0 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-muted">
      {host} /
    </span>
  );
}

/**
 * The link just made: the URL in the wide column because that is what gets
 * copied, with where it points and the downloads under it, and the QR beside
 * it at a size a phone can actually read. The host truncates, never the
 * slug: on a narrow screen the slug is the part that identifies the link.
 */
export function MadeLinkPanel({
  url,
  slug,
  detail,
  actions,
}: {
  url: string;
  slug: string;
  /** One quiet line under the link: where it points, or when it expires. */
  detail: ReactNode;
  /** Extra buttons after the downloads, e.g. Edit for an account. */
  actions?: ReactNode;
}) {
  const toast = useToast();
  const host = url.replace(/^https?:\/\//, "").slice(0, -slug.length);
  return (
    // The link arrives rather than appearing: it is the answer to the button
    // just pressed, and a panel that pops into the layout reads as a jump.
    <div className="anon-link-in grid grid-cols-shortener items-start gap-3 px-2 pt-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-3">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Your short link"
            className="flex min-w-0 flex-1 font-mono text-xs hover:text-accent sm:text-sm"
          >
            <span className="truncate text-muted">{host}</span>
            <span className="shrink-0 font-bold">{slug}</span>
          </a>
          <CopyButton
            text={url}
            label={`Copy ${url}`}
            onCopy={(text) => copyToClipboard(text, toast)}
          />
        </div>
        <p className="truncate text-xs text-muted">{detail}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Suspense fallback={<div className="h-8" aria-hidden="true" />}>
            <QrDownloadButtons url={url} name={`qr-${slug}`} />
          </Suspense>
          {actions}
        </div>
      </div>
      {/* Smaller on a phone so the slug keeps its width. */}
      <Suspense
        fallback={<div className="size-20 shrink-0 sm:size-26" aria-label="Preparing QR code" />}
      >
        <QRPreview url={url} sizeClass="size-20 sm:size-26" />
      </Suspense>
    </div>
  );
}

/** The quiet line under the bar: what is true now on the left, the way on
 *  the right. Ruled off when it follows a made link. */
export function HeroFooter({
  children,
  action,
  ruled = false,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  ruled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-2 pt-2.5 pb-1 text-xs text-muted",
        ruled && "anon-link-in mt-3 border-t border-border pt-3 [animation-delay:70ms]",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
