/**
 * Newsletter composer (platform admin). One issue at a time: a subject, plain
 * paragraphs and an optional button. A test goes to the admin alone; a send
 * goes to everyone who opted in (worker/marketing.ts decides who that is).
 */
import { useRef, useState } from "react";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { settle } from "../../lib/route-preload";
import { errorMessage } from "../../lib/error-message";
import { Button } from "../../ui/button";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { Field, Input, Textarea } from "../../ui/field";
import { BusyContent } from "../../ui/spinner";
import { useToast } from "../../ui/toast";
import { SectionHeading, fullNumber } from "./admin-kit";
import type { NewsletterSendResult, NewsletterStatus } from "@/shared/types";

const newsletterQuery = queryOptions<NewsletterStatus>({
  queryKey: ["admin", "newsletter"],
  queryFn: () => api("/admin/newsletter"),
});

export const preload = (qc: QueryClient) => settle([qc.ensureQueryData(newsletterQuery)]);

type Draft = { subject: string; body: string; ctaLabel: string; ctaUrl: string };
type Problems = { subject?: string; body?: string; ctaLabel?: string; ctaUrl?: string };
const EMPTY: Draft = { subject: "", body: "", ctaLabel: "", ctaUrl: "" };

/** The button's two fields: both or neither, and an http(s) link. */
function buttonProblems(label: string, url: string): Problems {
  if (url && !label) return { ctaLabel: "Name the button" };
  if (label && !/^https?:\/\//i.test(url)) return { ctaUrl: "Needs https://" };
  return {};
}

/** What is wrong with the draft, field by field. The server checks again. */
function problemsIn(draft: Draft): Problems {
  const problems = buttonProblems(draft.ctaLabel.trim(), draft.ctaUrl.trim());
  if (!draft.subject.trim()) problems.subject = "Add a subject";
  if (!draft.body.trim()) problems.body = "Write the email";
  return problems;
}

function focusFirst(problems: Problems, form: HTMLFormElement | null) {
  const first = (["subject", "body", "ctaLabel", "ctaUrl"] as const).find((k) => problems[k]);
  if (first) form?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
}

const people = (n: number) => `${fullNumber(n)} ${n === 1 ? "person" : "people"}`;

/** The draft, its field errors, and the two sends. */
function useComposer() {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problems, setProblems] = useState<Problems>({});
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  // One per composed issue: the provider skips batches it already sent under
  // it, so a retry after a failure cannot send twice. A ref: nothing shows it.
  // Made on the first send and cleared after a success, for the next issue.
  const sendId = useRef<string | null>(null);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblems((p) => ({ ...p, [key]: undefined }));
  };
  const payload = {
    subject: draft.subject,
    body: draft.body,
    ctaLabel: draft.ctaLabel || undefined,
    ctaUrl: draft.ctaUrl || undefined,
  };
  const check = (form: HTMLFormElement | null) => {
    const found = problemsIn(draft);
    setProblems(found);
    focusFirst(found, form);
    return Object.keys(found).length === 0;
  };
  /** Runs one send; true when it went. A failure is a toast. */
  const run = async (kind: "test" | "send", send: () => Promise<string>) => {
    setBusy(kind);
    try {
      toast(await send());
      return true;
    } catch (error) {
      toast(errorMessage(error), "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async (form: HTMLFormElement | null) => {
    if (!check(form)) return;
    await run("test", async () => {
      await api<NewsletterSendResult>("/admin/newsletter/test", { method: "POST", body: payload });
      return "Test sent to you";
    });
  };
  const sendAll = () =>
    run("send", async () => {
      const result = await api<NewsletterSendResult>("/admin/newsletter/send", {
        method: "POST",
        body: { ...payload, sendId: (sendId.current ??= crypto.randomUUID()) },
      });
      setDraft(EMPTY);
      sendId.current = null;
      await qc.invalidateQueries({ queryKey: ["admin", "newsletter"] });
      return `Sent to ${people(result.sent)}`;
    });

  return { draft, problems, busy, set, check, sendTest, sendAll };
}

function Audience({ status }: { status: NewsletterStatus | undefined }) {
  const optedIn = status?.optedIn ?? 0;
  return (
    <div className="rounded-xl bg-surface-2 p-4 text-sm">
      <p>
        <span className="font-semibold tabular-nums">{fullNumber(optedIn)}</span>{" "}
        {optedIn === 1 ? "person has" : "people have"} opted in. Only they get a send.
      </p>
      {status?.configured === false && (
        <p className="mt-1 text-muted">
          Sending is off. Set NEWSLETTER_FROM and the email provider key first.
        </p>
      )}
    </div>
  );
}

function IssueFields({ composer }: { composer: ReturnType<typeof useComposer> }) {
  const { draft, problems, set } = composer;
  return (
    <>
      <Field label="Subject" error={problems.subject}>
        <Input
          name="subject"
          value={draft.subject}
          onChange={(e) => set("subject")(e.target.value)}
          maxLength={150}
        />
      </Field>
      <Field
        label="Message"
        error={problems.body}
        hint="Plain text. Leave a blank line between paragraphs."
      >
        <Textarea
          name="body"
          rows={10}
          value={draft.body}
          onChange={(e) => set("body")(e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Button label" optional error={problems.ctaLabel}>
          <Input
            name="ctaLabel"
            value={draft.ctaLabel}
            onChange={(e) => set("ctaLabel")(e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="Button link" optional error={problems.ctaUrl}>
          <Input
            name="ctaUrl"
            inputMode="url"
            value={draft.ctaUrl}
            onChange={(e) => set("ctaUrl")(e.target.value)}
          />
        </Field>
      </div>
    </>
  );
}

export function AdminNewsletterPage() {
  const status = useQuery(newsletterQuery).data;
  const composer = useComposer();
  const { busy, check, sendTest, sendAll } = composer;
  const [confirming, setConfirming] = useState(false);
  const optedIn = status?.optedIn ?? 0;
  const locked = !status?.configured || busy !== null;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <SectionHeading>Newsletter</SectionHeading>
      <Audience status={status} />

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (check(event.currentTarget)) setConfirming(true);
        }}
      >
        <IssueFields composer={composer} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={(event) => void sendTest(event.currentTarget.form)}
          >
            <BusyContent busy={busy === "test"}>Send test to me</BusyContent>
          </Button>
          <Button type="submit" variant="primary" disabled={locked || optedIn === 0}>
            Send to {fullNumber(optedIn)}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        title="Send newsletter"
        open={confirming}
        onClose={() => busy === null && setConfirming(false)}
        onConfirm={() => void sendAll().then((sent) => sent && setConfirming(false))}
        confirmLabel={`Send to ${fullNumber(optedIn)}`}
        pending={busy === "send"}
      >
        <p>This emails {people(optedIn)} now. It cannot be recalled.</p>
      </ConfirmDialog>
    </div>
  );
}
