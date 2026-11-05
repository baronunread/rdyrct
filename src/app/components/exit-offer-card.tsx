import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { MorphIcon } from "morphicons/react";
import * as v from "valibot";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { Field, Input } from "../ui/field";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { check, copy } from "../ui/icon-nodes";
import { api, ApiError } from "../lib/api";
import { withErrorToast } from "../lib/mutation-toast";
import { CHALLENGE_LABEL, guardedButton, useTurnstile } from "../lib/turnstile";
import { MarketingLink } from "./marketing-link";
import { TurnstileSlot } from "./turnstile-slot";
import { TURNSTILE_TOKEN_HEADER } from "@/shared/types";

const emailSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty("Required"),
  v.email("Not an email address"),
);

/** The reason the email field shows, or null when the address will do. */
function emailProblem(email: string): string | null {
  const parsed = v.safeParse(emailSchema, email);
  return parsed.success ? null : (parsed.issues[0]?.message ?? "Not an email address");
}

/** How long "Copied" stays after the last click. */
const COPIED_MS = 2000;

/** Sends the address behind Turnstile. */
function useSendOffer(onSent: () => void, onBadEmail: (reason: string) => void) {
  const toast = useToast();
  const turnstile = useTurnstile("exit-offer");
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- a signed-out request that changes nothing this browser has cached.
  const send = useMutation({
    mutationFn: (email: string) =>
      turnstile.guarded((headers) =>
        api<{ sent: true }>("/exit-offer", {
          method: "POST",
          body: { email, turnstileToken: headers[TURNSTILE_TOKEN_HEADER] ?? "" },
        }),
      ),
    onSuccess: () => onSent(),
    onError: (error, email) => {
      // The server's one field-shaped refusal: an address it would not take.
      if (error instanceof ApiError && error.status === 400 && !error.code) {
        onBadEmail(emailProblem(email) ?? "Not an email address");
        return;
      }
      withErrorToast(toast)(error);
    },
  });
  return { send, turnstile };
}

/** The coupon: what it is worth on the left, the code and its Copy on the
 * right, split by a dashed rule. */
function Ticket({
  code,
  copyRef,
  onCopied,
}: {
  code: string;
  copyRef: RefObject<HTMLButtonElement | null>;
  onCopied: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      toast("Could not copy. Select the code and copy it by hand.", "error");
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    setCopied(true);
    onCopied();
  };

  return (
    <div className="flex items-stretch rounded-xl border border-dashed border-accent/50 bg-accent/[0.07]">
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-4 pr-3 pl-4">
        <span className="text-2xl leading-tight font-bold text-text tabular-nums">20% off</span>
        <span className="text-xs text-muted">first 3 months of Hobby or Pro</span>
      </div>
      <div aria-hidden className="my-3 border-l border-dashed border-accent/50" />
      <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 py-3 pr-3 pl-4">
        <span className="font-mono text-base font-bold tracking-widest text-accent select-all">
          {code}
        </span>
        <Button ref={copyRef} size="sm" variant="outline" onClick={copyCode}>
          <MorphIcon
            icon={copied ? check : copy}
            size={14}
            spring="snappy"
            className={copied ? "text-accent-2" : undefined}
          />
          <span className="min-w-11 text-left">{copied ? "Copied" : "Copy"}</span>
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Code copied" : ""}
        </span>
      </div>
    </div>
  );
}

/** "Email me the code": an address and a button on one line, replaced by
 * "Sent to …" once it goes. */
function EmailRow({ onSent }: { onSent: () => void }) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const markEmail = (reason: string) => {
    setError(reason);
    emailRef.current?.focus();
  };
  const { send, turnstile } = useSendOffer(onSent, markEmail);
  const button = guardedButton(send.isPending, turnstile.challenge);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = emailProblem(email);
    if (problem) return markEmail(problem);
    send.mutate(email.trim());
  };

  return (
    <div aria-live="polite">
      {send.isSuccess ? (
        // As tall as the label and field it replaces, so the card keeps its size.
        <p className="flex min-h-14.5 items-center text-sm text-pretty text-muted">
          <span>
            Sent to <span className="font-mono [overflow-wrap:anywhere]">{email.trim()}</span>.
          </span>
        </p>
      ) : (
        <form
          noValidate
          onInput={turnstile.prime}
          onSubmit={submit}
          className="flex flex-col gap-3"
        >
          <Field label="Or get it by email" error={error ?? undefined}>
            <div className="flex gap-2">
              <Input
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                placeholder="you@company.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                }}
              />
              <Button
                type="submit"
                variant="outline"
                className="shrink-0"
                disabled={button.disabled}
              >
                {button.spinning && <Spinner />}{" "}
                {button.waiting ? CHALLENGE_LABEL : "Email me the code"}
              </Button>
            </div>
          </Field>
          <TurnstileSlot challenge={turnstile.challenge} />
        </form>
      )}
    </div>
  );
}

/**
 * The exit offer's card (components/exit-offer.tsx decides when). Its own
 * chunk: most visitors never see it, so it loads only once the visitor has
 * been on the page long enough to be shown it.
 *
 * A coupon with the code on it (from /api/config) and a Copy control, "See
 * plans", and below them a quieter way to have the code emailed
 * (routes/exit-offer.ts).
 *
 * Copying, "See plans", the email and "No thanks" all answer the card, so it
 * never shows again in this browser. Escape, the × or a click outside only
 * put it away for the 30 days it would have stayed away anyway.
 */
export default function ExitOfferCard({
  open,
  code,
  onCopied,
  onAccepted,
  onSent,
  onDecline,
  onDismiss,
}: {
  open: boolean;
  code: string;
  onCopied: () => void;
  /** "See plans": the card closes as the pricing page opens. */
  onAccepted: () => void;
  onSent: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}) {
  const copyRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onDismiss()}
      title="Leaving already? Here’s 20% off"
      size="sm"
      initialFocus={copyRef}
    >
      <div className="flex flex-col gap-5">
        <p className="-mt-2 text-sm text-pretty text-muted">
          Use this code at checkout for your first 3 months of Hobby or Pro.
        </p>
        <Ticket code={code} copyRef={copyRef} onCopied={onCopied} />
        <MarketingLink
          to="/pricing"
          onClick={onAccepted}
          className={buttonClass({ variant: "primary", className: "w-full" })}
        >
          See plans
        </MarketingLink>
        <div className="flex flex-col gap-3 shadow-[inset_0_1px_0_var(--border)] pt-4">
          <EmailRow onSent={onSent} />
          <Button variant="ghost" className="self-center" onClick={onDecline}>
            No thanks
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
