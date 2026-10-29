import { useRef, useState, type FormEvent, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LegalPageLayout } from "../components/legal-page-layout";
import { Button } from "../ui/button";
import { Field, Input, Select } from "../ui/field";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { SUPPORT_EMAIL } from "../ui/footer";
import { api } from "../lib/api";
import { useAudience } from "../lib/audience";
import { CHALLENGE_LABEL, guardedButton, useTurnstile } from "../lib/turnstile";
import { TurnstileSlot } from "../components/turnstile-slot";
import { useSearchParams } from "../lib/router-search";
import { withErrorToast } from "../lib/mutation-toast";
import { TURNSTILE_TOKEN_HEADER, REPORT_REASONS, type ReportReason } from "@/shared/types";

const REASON_LABELS = {
  phishing: "Phishing or a scam",
  malware: "Malware",
  spam: "Spam",
  other: "Something else",
} satisfies Record<ReportReason, string>;

const reasonFrom = (value: string): ReportReason =>
  REPORT_REASONS.find((r) => r === value) ?? "phishing";

/** The one field the report needs. Empty on submit, it is marked. */
function ShortLinkField({
  value,
  missing,
  inputRef,
  onChange,
}: {
  value: string;
  missing: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      label="Short link"
      error={missing ? "Required" : undefined}
      errorDetail="Paste the short link you want to report"
    >
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://rdyr.cc/abc1234"
        maxLength={300}
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />
    </Field>
  );
}

/** The short link's value, and whether it was missing at the last submit.
 * `filled()` marks and focuses the field when it is empty. */
function useShortLink(initial: string | null) {
  const [value, setValue] = useState(initial ?? "");
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filled = () => {
    const ok = value.trim() !== "";
    setMissing(!ok);
    if (!ok) inputRef.current?.focus();
    return ok;
  };
  const onChange = (next: string) => {
    setValue(next);
    setMissing(false);
  };
  return { value, filled, field: { value, missing, inputRef, onChange } };
}

export function ReportPage() {
  const { authed } = useAudience();
  const toast = useToast();
  const turnstile = useTurnstile("report");
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const shortLink = useShortLink(params.get("link"));
  const link = shortLink.value;
  const [reason, setReason] = useState<ReportReason>("phishing");
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");

  const send = useMutation({
    mutationFn: () =>
      turnstile.guarded((headers) =>
        api("/reports", {
          method: "POST",
          body: {
            link,
            reason,
            note,
            contact,
            turnstileToken: headers[TURNSTILE_TOKEN_HEADER] ?? "",
          },
        }),
      ),
    // An admin with the Reports tab open sees the new report on its next read.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "reports"] }),
    onError: withErrorToast(toast),
  });
  const button = guardedButton(send.isPending, turnstile.challenge);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (shortLink.filled()) send.mutate();
  };

  return (
    <LegalPageLayout
      authed={authed}
      title="Report a link"
      intro="Tell us about a rdyrct short link used for phishing, malware or spam. We review reports and stop links that break our terms. We do not store your IP address, and your email is optional."
    >
      {send.isSuccess ? (
        <p role="status" className="rounded-lg bg-surface-2 p-4">
          Thanks. We will look at it. Nothing more is needed from you.
        </p>
      ) : (
        <form
          noValidate
          onInput={turnstile.prime}
          onSubmit={submit}
          className="flex flex-col gap-4"
        >
          <ShortLinkField {...shortLink.field} />
          <Field label="What is wrong with it?">
            <Select value={reason} onChange={(e) => setReason(reasonFrom(e.target.value))}>
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Details (optional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What the page asks for, or where you saw the link"
              maxLength={1000}
            />
          </Field>
          <Field label="Your email (optional)" hint="Only if you want us to be able to ask you.">
            <Input
              type="email"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={200}
            />
          </Field>
          <TurnstileSlot challenge={turnstile.challenge} />
          <div>
            <Button type="submit" disabled={button.disabled}>
              {button.spinning && <Spinner />} {button.waiting ? CHALLENGE_LABEL : "Send report"}
            </Button>
          </div>
          <p className="text-xs text-muted">
            Own a link that was stopped by mistake? Write to {SUPPORT_EMAIL}.
          </p>
        </form>
      )}
    </LegalPageLayout>
  );
}
