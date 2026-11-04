/**
 * Newsletter composer (platform admin). One issue at a time: a subject and a
 * body written in the email editor (headings, lists, links, a button). A test goes to the admin alone; a send
 * goes to everyone who opted in (worker/marketing.ts decides who that is).
 */
import { useId, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { settle } from "../../lib/route-preload";
import { errorMessage } from "../../lib/error-message";
import { Button } from "../../ui/button";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { Field, FieldReason, Input } from "../../ui/field";
import { BusyContent } from "../../ui/spinner";
import { useToast } from "../../ui/toast";
import { SectionHeading, fullNumber } from "./admin-kit";
import { NewsletterEditor } from "./newsletter-editor";
import { shortDate } from "../../lib/dates";
import type {
  NewsletterAnswers,
  NewsletterSendResult,
  NewsletterSendRow,
  NewsletterStatus,
} from "@/shared/types";

const newsletterQuery = queryOptions<NewsletterStatus>({
  queryKey: ["admin", "newsletter"],
  queryFn: () => api("/admin/newsletter"),
});

export const preload = (qc: QueryClient) => settle([qc.ensureQueryData(newsletterQuery)]);

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

const people = (n: number) => `${fullNumber(n)} ${n === 1 ? "person" : "people"}`;

/** The draft, its field errors, and the two sends. The body lives in the
 * editor; it is read from there when a send needs it. */
function useComposer() {
  const qc = useQueryClient();
  const toast = useToast();
  const [subject, setSubjectValue] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // One per composed issue: the provider skips batches it already sent under
  // it, so a retry after a failure cannot send twice. A ref: nothing shows it.
  // Made on the first send and cleared after a success, for the next issue.
  const sendId = useRef<string | null>(null);

  const setSubject = (value: string) => {
    setSubjectValue(value);
    setProblems((p) => ({ ...p, subject: undefined }));
  };
  const bodyChanged = () => setProblems((p) => (p.body ? { ...p, body: undefined } : p));
  const payload = () => ({ subject, doc: editorRef.current?.getJSON() });
  /** Marks what is wrong, field by field, and focuses the first. The server
   * checks again. */
  const check = (form: HTMLFormElement | null) => {
    const found: Problems = {};
    if (!subject.trim()) found.subject = "Add a subject";
    const text = editorRef.current?.getText() ?? "";
    if (!text.trim()) found.body = "Write the email";
    else if (text.length > MAX_TEXT) found.body = "The email is too long";
    else if (buttonWithoutLink(editorRef.current)) found.body = "A button needs a link";
    setProblems(found);
    if (found.subject) form?.querySelector<HTMLElement>('[name="subject"]')?.focus();
    else if (found.body) editorRef.current?.commands.focus();
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
      await api<NewsletterSendResult>("/admin/newsletter/test", {
        method: "POST",
        body: payload(),
      });
      return "Test sent to you";
    });
  };
  const sendAll = () =>
    run("send", async () => {
      const result = await api<NewsletterSendResult>("/admin/newsletter/send", {
        method: "POST",
        body: { ...payload(), sendId: (sendId.current ??= crypto.randomUUID()) },
      });
      await qc.invalidateQueries({ queryKey: ["admin", "newsletter"] });
      // Stopped at the per-request limit with people left: the same send id
      // and the same issue carry on from where it stopped.
      if (!result.done)
        return `Sent to ${people(result.sent)} so far. Send again to reach the rest.`;
      setSubjectValue("");
      editorRef.current?.commands.clearContent();
      sendId.current = null;
      return `Sent to ${people(result.sent)}`;
    });

  return { subject, problems, busy, editorRef, setSubject, bodyChanged, check, sendTest, sendAll };
}

/** One count with its label, for the answers row. */
function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{fullNumber(value)}</dd>
    </div>
  );
}

/** Where the yeses came from, as a line under the counts. */
function yesSources(yes: NewsletterAnswers["yes"]): string {
  return [
    `${fullNumber(yes.signup)} at sign-up`,
    `${fullNumber(yes.prompt)} from the dialog`,
    `${fullNumber(yes.settings)} in Settings`,
  ].join(" · ");
}

function Audience({ status }: { status: NewsletterStatus | undefined }) {
  const optedIn = status?.optedIn ?? 0;
  const answers = status?.answers;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4 text-sm">
      <p>
        <span className="font-semibold tabular-nums">{fullNumber(optedIn)}</span>{" "}
        {optedIn === 1 ? "person gets" : "people get"} a send: opted in, verified and not banned.
      </p>
      {answers && (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Count
              label="Said yes"
              value={answers.yes.signup + answers.yes.prompt + answers.yes.settings}
            />
            <Count label="Said no" value={answers.no} />
            <Count label="Not asked yet" value={answers.unasked} />
          </dl>
          <p className="text-xs text-muted">{yesSources(answers.yes)}</p>
        </>
      )}
      {status?.configured === false && (
        <p className="text-muted">
          Sending is off. Set NEWSLETTER_FROM and the email provider key first.
        </p>
      )}
    </div>
  );
}

/** The issues that went out, newest first. */
function SendHistory({ sends }: { sends: NewsletterSendRow[] }) {
  return (
    <section aria-labelledby="sent-heading" className="flex flex-col gap-2">
      <h3 id="sent-heading" className="text-sm font-semibold">
        Sent
      </h3>
      {sends.length === 0 ? (
        <p className="text-sm text-muted">Nothing sent yet.</p>
      ) : (
        <ol className="divide-y divide-border rounded-xl border border-border">
          {sends.map((send) => (
            <li key={send.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
              <span className="min-w-0 truncate font-medium">{send.subject}</span>
              <span className="text-xs text-muted">
                {shortDate(send.sentAt)} · to {fullNumber(send.sent)}
                {send.done ? "" : " so far, not finished"}
                {send.sentBy ? ` · by ${send.sentBy}` : ""}
              </span>
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
          // The editor's link and button forms sit inside this one, and
          // React bubbles their submit here. Only this form's own counts.
          if (event.target !== event.currentTarget) return;
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

      <SendHistory sends={status?.sends ?? []} />
    </div>
  );
}
