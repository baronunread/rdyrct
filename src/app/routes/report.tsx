import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LegalPageLayout } from "../components/legal-page-layout";
import { Button } from "../ui/button";
import { Field, Input, Select } from "../ui/field";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { SUPPORT_EMAIL } from "../ui/footer";
import { api } from "../lib/api";
import { useAudience } from "../lib/audience";
import { useCap } from "../lib/cap";
import { useSearchParams } from "../lib/router-search";
import { withErrorToast } from "../lib/mutation-toast";
import { CAP_TOKEN_HEADER, REPORT_REASONS, type ReportReason } from "@/shared/types";

const REASON_LABELS = {
  phishing: "Phishing or a scam",
  malware: "Malware",
  spam: "Spam",
  other: "Something else",
} satisfies Record<ReportReason, string>;

const reasonFrom = (value: string): ReportReason =>
  REPORT_REASONS.find((r) => r === value) ?? "phishing";

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function ReportPage() {
  const { authed } = useAudience();
  const toast = useToast();
  const cap = useCap("report");
  const [params] = useSearchParams();
  const [link, setLink] = useState(params.get("link") ?? "");
  const [reason, setReason] = useState<ReportReason>("phishing");
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");

  const send = useMutation({
    mutationFn: () =>
      cap.guarded((headers) =>
        api("/reports", {
          method: "POST",
          body: { link, reason, note, contact, capToken: headers[CAP_TOKEN_HEADER] ?? "" },
        }),
      ),
    onError: withErrorToast(toast),
  });

  return (
    <LegalPageLayout authed={authed}>
      <div>
        <h1 className="mb-2 text-xl font-bold">Report a link</h1>
        <p className="text-muted">
          Tell us about a rdyrct short link used for phishing, malware or spam. We review reports
          and stop links that break our terms. We do not store your IP address, and your email is
          optional.
        </p>
      </div>

      {send.isSuccess ? (
        <p role="status" className="rounded-lg bg-surface-2 p-4">
          Thanks. We will look at it. Nothing more is needed from you.
        </p>
      ) : (
        <form
          noValidate
          onInput={cap.prime}
          onSubmit={(event) => {
            event.preventDefault();
            if (!link.trim()) return toast("Paste the short link", "error");
            send.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Short link">
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://rdyr.cc/abc1234"
              maxLength={300}
            />
          </Field>
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
          <div>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending && <Spinner />} Send report
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
