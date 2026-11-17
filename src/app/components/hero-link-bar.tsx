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
import { FieldReason, NO_AUTOFILL } from "../ui/field";
import { invalidAria } from "../ui/invalid-aria";
import { CopyButton } from "../ui/copy-button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { CHALLENGE_LABEL } from "../lib/turnstile";
import { cn } from "../ui/cn";
import { Tooltip } from "@/app/ui/tooltip";

// Loaded only once a link exists, to spare readers the encoder. A failed load (a stale tab
// after a deploy) shows no QR instead of reaching the error boundary.
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

export const HERO_CARD =
  "w-full max-w-xl rounded-2xl bg-surface p-2 text-left smooth-shadow-ring-sm";

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
  title?: string;
  again?: boolean;
  waiting?: boolean;
  error?: BarError | null;
}) {
  const reasonId = useId();
  const invalid = invalidAria(error?.reason, reasonId);
  return (
    <div className="group/bar flex flex-col gap-2 rounded-xl border border-border bg-bg p-1 focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)] has-[[aria-invalid=true]]:border-danger has-[[aria-invalid=true]]:focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_18%,transparent)] sm:flex-row sm:items-center sm:gap-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
        <span className="contents group-has-[[aria-invalid=true]]/bar:max-sm:hidden">{prefix}</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="off"
          {...NO_AUTOFILL}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={again ? "Paste another…" : "Paste a long link…"}
          {...input}
          {...invalid}
          // The bar draws the focus ring; the ! beats the unlayered global one in styles.css.
          className="h-9 min-w-0 flex-1 bg-transparent px-1 text-base text-text outline-none! placeholder:text-placeholder sm:text-sm"
        />
        {error && <BarReason id={reasonId} error={error} />}
      </div>
      {/* A disabled button takes no pointer events, so the reason sits on a wrapper. */}
      <Tooltip content={title}>
        <span className="grid">
          <Button
            variant="primary"
            type="submit"
            disabled={disabled}
            className="h-9 rounded-lg sm:w-auto"
          >
            <BusyContent busy={busy}>
              <ShortenLabel waiting={waiting} />
            </BusyContent>
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}

export type BarError = { reason: string; detail: string };

function BarReason({ id, error }: { id: string; error: BarError }) {
  return (
    <span className="max-w-[45%] shrink-0 pr-1.5 text-xs">
      <FieldReason id={id} reason={error.reason} detail={error.detail} />
    </span>
  );
}

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

export function HostPrefix({ host }: { host: string }) {
  return (
    <span className="shrink-0 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-muted">
      {host} /
    </span>
  );
}

/** The host truncates, never the slug: on a narrow screen the slug identifies the link. */
export function MadeLinkPanel({
  url,
  slug,
  detail,
  actions,
}: {
  url: string;
  slug: string;
  detail: ReactNode;
  actions?: ReactNode;
}) {
  const toast = useToast();
  const host = url.replace(/^https?:\/\//, "").slice(0, -slug.length);
  return (
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
      <Suspense
        fallback={<div className="size-20 shrink-0 sm:size-26" aria-label="Preparing QR code" />}
      >
        <QRPreview url={url} sizeClass="size-20 sm:size-26" />
      </Suspense>
    </div>
  );
}

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
