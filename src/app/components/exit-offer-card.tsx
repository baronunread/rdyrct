import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import * as v from "valibot";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { api, ApiError } from "../lib/api";
import { withErrorToast } from "../lib/mutation-toast";
import { CHALLENGE_LABEL, guardedButton, useTurnstile } from "../lib/turnstile";
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

/**
 * The exit offer's card (components/exit-offer.tsx decides when). Its own
 * chunk: most visitors never see it, so it loads only once the visitor has
 * been on the page long enough to be shown it.
 *
 * It asks for an address and emails the discount code (routes/exit-offer.ts).
 *
 * Three ways out: "Email me the code" (then "Check your inbox" in the same
 * card), "No thanks", which means never again in this browser, and Escape or
 * a click outside, which only puts it away for the 30 days it would have
 * stayed away anyway.
 */
export default function ExitOfferCard({
  open,
  onSent,
  onDecline,
  onDismiss,
  onDone,
}: {
  open: boolean;
  onSent: () => void;
  onDecline: () => void;
  onDismiss: () => void;
  /** Closes "Check your inbox": not a dismissal, the visitor said yes. */
  onDone: () => void;
}) {
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

  if (send.isSuccess) {
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => !next && onDone()}
        title="Check your inbox"
        size="sm"
      >
        <div className="flex flex-col gap-5">
          <p role="status" className="-mt-2 text-sm text-pretty text-muted">
            We sent the code to{" "}
            <span className="font-mono [overflow-wrap:anywhere] text-text">{email.trim()}</span>.
          </p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onDismiss()}
      title="Before you go: 20% off for 3 months"
      size="sm"
      initialFocus={emailRef}
    >
      <form noValidate onInput={turnstile.prime} onSubmit={submit} className="flex flex-col gap-5">
        <p className="-mt-2 text-sm text-pretty text-muted">
          Leave your email and we’ll send you a code for 20% off your first 3 months of Hobby or
          Pro.
        </p>
        <Field label="Email" error={error ?? undefined}>
          <Input
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
          />
        </Field>
        <TurnstileSlot challenge={turnstile.challenge} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onDecline}>
            No thanks
          </Button>
          <Button type="submit" variant="primary" disabled={button.disabled}>
            {button.spinning && <Spinner />}{" "}
            {button.waiting ? CHALLENGE_LABEL : "Email me the code"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
