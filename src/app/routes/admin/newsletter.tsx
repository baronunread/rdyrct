/**
 * Newsletter composer (platform admin). One issue at a time, to one list
 * (product news or offers) narrowed by stage and plan (worker/marketing.ts
 * decides who): a subject and a body written in the email editor. A test
 * goes to the admin alone, at once; a send goes now or at a scheduled time,
 * through a Cloudflare Workflow (worker/newsletter-send.ts). The page is the
 * composer first; who has answered sits in two quiet lines under the
 * history.
 */
import { useId, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "../../lib/api";
import { settle } from "../../lib/route-preload";
import { errorMessage } from "../../lib/error-message";
import { Button } from "../../ui/button";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { Field, FieldReason, Input } from "../../ui/field";
import { BusyContent } from "../../ui/spinner";
import { useToast } from "../../ui/toast";
import { SectionHeading, StateLabel, fullNumber, type StateTone } from "./admin-kit";
import { NewsletterEditor } from "./newsletter-editor";
import { AudienceField, audienceTail, filterLabels } from "./newsletter-audience";
import { SchedulePicker, whenWords } from "./newsletter-schedule";
import { shortDate } from "../../lib/dates";
import {
  EVERYONE,
  MARKETING_LIST_LABELS,
  MARKETING_LISTS,
  type AudienceFilter,
  type MarketingList,
  type NewsletterAudienceCount,
  type NewsletterAnswers,
  type NewsletterSendRow,
  type NewsletterSendState,
  type NewsletterSendStatus,
  type NewsletterStatus,
} from "@/shared/types";

/** Asked again every few seconds while a send is going out, or due to. */
const newsletterQuery = queryOptions<NewsletterStatus>({
  queryKey: ["admin", "newsletter"],
  queryFn: () => api("/admin/newsletter"),
  refetchInterval: (query) =>
    query.state.data?.sends.some(
      (send) =>
        send.status === "sending" ||
        (send.status === "scheduled" && (send.scheduledFor ?? 0) <= Date.now()),
    )
      ? 3000
      : false,
});

/** How many people a send to `list` with `filter` reaches, asked again as
 * either changes. The last answer stays up while the next one loads. */
const audienceQuery = (list: MarketingList, filter: AudienceFilter) =>
  queryOptions<NewsletterAudienceCount>({
    queryKey: ["admin", "newsletter", "audience", list, filter.stage, filter.plan],
    queryFn: () =>
      api(`/admin/newsletter/audience?${new URLSearchParams({ list, ...filter }).toString()}`),
    placeholderData: keepPreviousData,
  });

export const preload = (qc: QueryClient) =>
  settle([
    qc.ensureQueryData(newsletterQuery),
    qc.ensureQueryData(audienceQuery("news", EVERYONE)),
  ]);

type Problems = { subject?: string; body?: string };

/** Whether a button in the body still has no http(s) link (the editor's
 * new button starts with none). */
function buttonWithoutLink(editor: Editor | null): boolean {
  let missing = false;
  editor?.state.doc.descendants((node) => {
    if (node.type.name === "button" && !/^https?:\/\/\S/i.test(String(node.attrs.href ?? ""))) {
      missing = true;
    }
    return !missing;
  });
  return missing;
}

/** All the text a body may hold; the server refuses more (newsletter-doc.ts). */
const MAX_TEXT = 20_000;

/** The draft, its field errors, and the three ways to send it. The body
 * lives in the editor; it is read from there when a send needs it. */
function useComposer(list: MarketingList, audience: AudienceFilter) {
  const qc = useQueryClient();
  const toast = useToast();
  const [subject, setSubjectValue] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [busy, setBusy] = useState<"test" | "send" | "schedule" | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // One per composed issue, and the id of the send's workflow: sending the
  // same id twice (a double click, a retry) starts nothing new. A ref:
  // nothing shows it. Made on the first send and cleared after a success.
  const sendId = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const setSubject = (value: string) => {
    setSubjectValue(value);
    setProblems((p) => ({ ...p, subject: undefined }));
  };
  const bodyChanged = () => setProblems((p) => (p.body ? { ...p, body: undefined } : p));
  const payload = () => ({ list, subject, doc: editorRef.current?.getJSON() });
  /** Marks what is wrong, field by field, and focuses the first. The server
   * checks again. */
  const check = () => {
    const found: Problems = {};
    if (!subject.trim()) found.subject = "Add a subject";
    const text = editorRef.current?.getText() ?? "";
    if (!text.trim()) found.body = "Write the email";
    else if (text.length > MAX_TEXT) found.body = "The email is too long";
    else if (buttonWithoutLink(editorRef.current)) found.body = "A button needs a link";
    setProblems(found);
    if (found.subject) formRef.current?.querySelector<HTMLElement>('[name="subject"]')?.focus();
    else if (found.body) editorRef.current?.commands.focus();
    return Object.keys(found).length === 0;
  };
  /** Runs one send; true when it went. A failure is a toast. */
  const run = async (kind: "test" | "send" | "schedule", send: () => Promise<string>) => {
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

  const sendTest = async () => {
    if (!check()) return;
    await run("test", async () => {
      await api("/admin/newsletter/test", { method: "POST", body: payload() });
      return "Test sent to you";
    });
  };
  /** Send now (no time) or Schedule. */
  const send = (scheduledFor?: number) =>
    run(scheduledFor ? "schedule" : "send", async () => {
      const state = await api<NewsletterSendState>("/admin/newsletter/send", {
        method: "POST",
        body: {
          ...payload(),
          audience,
          sendId: (sendId.current ??= crypto.randomUUID()),
          ...(scheduledFor && { scheduledFor }),
        },
      });
      await qc.invalidateQueries({ queryKey: ["admin", "newsletter"] });
      setSubjectValue("");
      editorRef.current?.commands.clearContent();
      sendId.current = null;
      return state.scheduledFor ? `Scheduled for ${whenWords(state.scheduledFor)}` : "Sending";
    });

  /** A send to another list, or other filters, is another send: the next
   * one gets a new id. */
  const audienceChanged = () => {
    sendId.current = null;
  };

  return {
    subject,
    problems,
    busy,
    editorRef,
    formRef,
    setSubject,
    bodyChanged,
    check,
    sendTest,
    send,
    audienceChanged,
  };
}

/** One list's answers as a line: yes (and where from), no, not asked. */
function answersLine(answers: NewsletterAnswers): string {
  const { onboarding, prompt, settings } = answers.yes;
  const yes = onboarding + prompt + settings;
  return [
    `${fullNumber(yes)} said yes (${fullNumber(onboarding)} in onboarding, ${fullNumber(prompt)} from the dialog, ${fullNumber(settings)} in Settings)`,
    `${fullNumber(answers.no)} said no`,
    `${fullNumber(answers.unasked)} not asked yet`,
  ].join(", ");
}

/** Who has answered, per list: two quiet lines, not a dashboard. */
function Answers({ status }: { status: NewsletterStatus }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h3 id={headingId} className="text-sm font-semibold">
        Answers
      </h3>
      <dl className="flex flex-col gap-1 text-xs text-muted">
        {MARKETING_LISTS.map((id) => (
          <div key={id} className="flex flex-col sm:flex-row sm:gap-1.5">
            <dt className="shrink-0 font-medium text-text">{MARKETING_LIST_LABELS[id]}</dt>
            <dd className="tabular-nums">{answersLine(status.answers[id])}.</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const STATUS = {
  scheduled: { tone: "warn", label: "Scheduled" },
  sending: { tone: "warn", label: "Sending" },
  sent: { tone: "ok", label: "Sent" },
  cancelled: { tone: "quiet", label: "Cancelled" },
  failed: { tone: "bad", label: "Failed" },
} satisfies Record<NewsletterSendStatus, { tone: StateTone; label: string }>;

/** When a send went or goes, and how far it got, in words. */
function sendLine(send: NewsletterSendRow): string {
  const who = [MARKETING_LIST_LABELS[send.list], ...filterLabels(send.audience)].join(" · ");
  const when = send.scheduledFor ?? send.createdAt;
  switch (send.status) {
    case "scheduled":
      return `${who} · goes ${whenWords(when)}`;
    case "sending":
      return `${who} · ${fullNumber(send.sent)} so far`;
    case "cancelled":
      return `${who} · was set for ${shortDate(when)}`;
    case "sent":
    case "failed":
      return `${who} · ${shortDate(send.finishedAt ?? when)} · to ${fullNumber(send.sent)}`;
  }
}

/** Scheduled sends first, soonest first, then the rest, newest first. */
function SendHistory({ sends }: { sends: NewsletterSendRow[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api<NewsletterSendState>(`/admin/newsletter/sends/${id}/cancel`, { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "newsletter"] });
      toast("Send cancelled");
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });
  return (
    <section aria-labelledby="sends-heading" className="flex flex-col gap-2">
      <h3 id="sends-heading" className="text-sm font-semibold">
        Sends
      </h3>
      {sends.length === 0 ? (
        <p className="text-sm text-muted">Nothing sent or scheduled yet.</p>
      ) : (
        <ol className="rounded-xl bg-surface smooth-shadow-ring-xs [&>*+*]:shadow-[inset_0_1px_0_var(--border)]">
          {sends.map((send) => (
            <li key={send.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
              {/* On a phone the state and Cancel take a line of their own. */}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 max-sm:basis-full">
                <span className="truncate text-sm font-medium" title={send.subject}>
                  {send.subject}
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {sendLine(send)}
                  {send.sentBy && (
                    <>
                      {" · "}
                      <span className="whitespace-nowrap">
                        by <span className="font-mono">{send.sentBy}</span>
                      </span>
                    </>
                  )}
                </span>
              </span>
              <StateLabel tone={STATUS[send.status].tone}>{STATUS[send.status].label}</StateLabel>
              {send.status === "scheduled" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="max-sm:ml-auto"
                  disabled={cancel.isPending}
                  aria-label={`Cancel ${send.subject}`}
                  onClick={() => cancel.mutate(send.id)}
                >
                  <BusyContent busy={cancel.isPending && cancel.variables === send.id}>
                    Cancel
                  </BusyContent>
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function IssueFields({ composer }: { composer: ReturnType<typeof useComposer> }) {
  const { subject, problems, editorRef, setSubject, bodyChanged } = composer;
  const labelId = useId();
  const reasonId = useId();
  return (
    <>
      <Field label="Subject" error={problems.subject}>
        <Input
          name="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={150}
        />
      </Field>
      {/* Not a Field: that is a <label>, and a label around an editor with
          menus inside it forwards their clicks. The same label row. */}
      <div className="min-w-0">
        <span className="mb-1.5 flex min-h-4 items-center gap-1.5 text-xs text-muted">
          <span id={labelId} className="shrink-0">
            Message
          </span>
          {problems.body && <FieldReason id={reasonId} reason={problems.body} />}
        </span>
        <NewsletterEditor
          editorRef={editorRef}
          labelId={labelId}
          reasonId={reasonId}
          invalid={Boolean(problems.body)}
          onChange={bodyChanged}
        />
        <span className="mt-1 block text-xs text-muted">
          Select text to format it or add a link. Type / for a heading, list, divider or button.
        </span>
      </div>
    </>
  );
}

export function AdminNewsletterPage() {
  const status = useQuery(newsletterQuery).data;
  const [list, setList] = useState<MarketingList>("news");
  const [filter, setFilter] = useState<AudienceFilter>(EVERYONE);
  const audience = useQuery(audienceQuery(list, filter));
  const count = audience.data?.count;
  const composer = useComposer(list, filter);
  const { busy, check, sendTest, send, audienceChanged, formRef } = composer;
  const [confirming, setConfirming] = useState(false);
  const pickList = (next: MarketingList) => {
    if (next === list || busy !== null) return;
    setList(next);
    audienceChanged();
  };
  const pickFilter = (next: AudienceFilter) => {
    if (busy !== null) return;
    setFilter(next);
    audienceChanged();
  };
  const locked = !status?.configured || busy !== null;
  const reach = count ?? 0;

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <SectionHeading>Newsletter</SectionHeading>
      {status?.configured === false && (
        <p className="text-sm text-muted">
          Sending is off. Set NEWSLETTER_FROM and the email provider key first.
        </p>
      )}
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          // The editor's link and button forms sit inside this one, and
          // React bubbles their submit here. Only this form's own counts.
          if (event.target !== event.currentTarget) return;
          if (check()) setConfirming(true);
        }}
      >
        <AudienceField
          list={list}
          filter={filter}
          counted={audience.data}
          stale={audience.isPlaceholderData}
          disabled={busy !== null}
          onList={pickList}
          onFilter={pickFilter}
        />
        <IssueFields composer={composer} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            className="max-sm:w-full sm:-ml-2.5"
            disabled={locked}
            onClick={() => void sendTest()}
          >
            <BusyContent busy={busy === "test"}>Send test to me</BusyContent>
          </Button>
          <div className="ml-auto flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
            <SchedulePicker
              disabled={locked}
              busy={busy === "schedule"}
              onOpen={check}
              onSchedule={(at) => send(at)}
            />
            <Button type="submit" variant="primary" disabled={locked || reach === 0}>
              Send now
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        title="Send newsletter"
        open={confirming}
        onClose={() => busy === null && setConfirming(false)}
        onConfirm={() => void send().then((sent) => sent && setConfirming(false))}
        confirmLabel={`Send to ${fullNumber(reach)}`}
        pending={busy === "send"}
      >
        <p>
          This emails {fullNumber(reach)} {audienceTail(reach, list, filter)} now. It cannot be
          recalled.
        </p>
      </ConfirmDialog>

      <SendHistory sends={status?.sends ?? []} />
      {status && <Answers status={status} />}
    </div>
  );
}
