/**
 * Newsletter composer (platform admin). One issue at a time, to one list
 * (product news or offers): a subject and a body written in the email editor
 * (headings, lists, links, a button). A test goes to the admin alone; a send
 * goes to everyone opted in to that list, narrowed by stage and plan
 * (worker/marketing.ts decides who).
 */
import { useId, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import {
  keepPreviousData,
  queryOptions,
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
import { Segmented } from "../../ui/segmented";
import { Skeleton } from "../../ui/skeleton";
import { SectionHeading, fullNumber } from "./admin-kit";
import { NewsletterEditor } from "./newsletter-editor";
import { shortDate } from "../../lib/dates";
import {
  ACTIVE_WITHIN_DAYS,
  AUDIENCE_PLANS,
  AUDIENCE_STAGES,
  EVERYONE,
  MARKETING_LIST_LABELS,
  MARKETING_LISTS,
  type AudienceFilter,
  type AudiencePlan,
  type AudienceStage,
  type MarketingList,
  type NewsletterAudienceCount,
  type NewsletterAnswers,
  type NewsletterSendResult,
  type NewsletterSendRow,
  type NewsletterStatus,
} from "@/shared/types";

const newsletterQuery = queryOptions<NewsletterStatus>({
  queryKey: ["admin", "newsletter"],
  queryFn: () => api("/admin/newsletter"),
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

const people = (n: number) => `${fullNumber(n)} ${n === 1 ? "person" : "people"}`;

/** The audience picker's choices. */
const LIST_ITEMS = MARKETING_LISTS.map((id) => ({ id, label: MARKETING_LIST_LABELS[id] }));

const STAGE_LABELS = {
  any: "Everyone",
  new: "New",
  active: "Active",
  slipping: "Slipping away",
} satisfies Record<AudienceStage, string>;
const STAGE_ITEMS = AUDIENCE_STAGES.map((id) => ({ id, label: STAGE_LABELS[id] }));

const PLAN_LABELS = { any: "Any", free: "Free", paid: "Paid" } satisfies Record<
  AudiencePlan,
  string
>;
const PLAN_ITEMS = AUDIENCE_PLANS.map((id) => ({ id, label: PLAN_LABELS[id] }));

/** What each filter keeps, as the end of "people on Offers who …". */
const STAGE_WORDS = {
  any: null,
  new: "have not made a link yet",
  active: `made a link and came back in the last ${ACTIVE_WITHIN_DAYS} days`,
  slipping: `made a link but have not been back for ${ACTIVE_WITHIN_DAYS} days`,
} satisfies Record<AudienceStage, string | null>;
const PLAN_WORDS = {
  any: null,
  free: "are on Free",
  paid: "are on a paid plan",
} satisfies Record<AudiencePlan, string | null>;

/** "people on Offers who are on Free and have not made a link yet", after
 * a count of `n`. */
function audienceTail(n: number, list: MarketingList, filter: AudienceFilter): string {
  const clauses = [PLAN_WORDS[filter.plan], STAGE_WORDS[filter.stage]].filter(Boolean);
  const who = clauses.length > 0 ? ` who ${clauses.join(" and ")}` : "";
  return `${n === 1 ? "person" : "people"} on ${MARKETING_LIST_LABELS[list]}${who}`;
}

/** The filters a past send used, for its history line; nothing for none. */
function filterLabels(filter: AudienceFilter): string[] {
  return [
    filter.stage === "any" ? null : STAGE_LABELS[filter.stage],
    filter.plan === "any" ? null : PLAN_LABELS[filter.plan],
  ].filter((label) => label !== null);
}

/** The draft, its field errors, and the two sends. The body lives in the
 * editor; it is read from there when a send needs it. */
function useComposer(list: MarketingList, audience: AudienceFilter) {
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
  const payload = () => ({ list, subject, doc: editorRef.current?.getJSON() });
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
        body: { ...payload(), audience, sendId: (sendId.current ??= crypto.randomUUID()) },
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
    setSubject,
    bodyChanged,
    check,
    sendTest,
    sendAll,
    audienceChanged,
  };
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

/** One list's answers: yes, no, not asked, and where the yeses came from. */
function ListAnswers({ list, answers }: { list: MarketingList; answers: NewsletterAnswers }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {MARKETING_LIST_LABELS[list]}
      </h3>
      <dl className="grid grid-cols-3 gap-3">
        <Count
          label="Said yes"
          value={answers.yes.signup + answers.yes.prompt + answers.yes.settings}
        />
        <Count label="Said no" value={answers.no} />
        <Count label="Not asked yet" value={answers.unasked} />
      </dl>
      <p className="text-xs text-muted">{yesSources(answers.yes)}</p>
    </section>
  );
}

/** One filter: what it is called, and its choices. */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="text-xs text-muted sm:w-14 sm:shrink-0">{label}</span>
      {children}
    </div>
  );
}

/** Who a send reaches: the list, the filters, and how many people that is. */
function Audience({
  status,
  list,
  filter,
  counted,
  stale,
  onList,
  onFilter,
}: {
  status: NewsletterStatus | undefined;
  list: MarketingList;
  filter: AudienceFilter;
  /** The last count and what it counted; worded from its own list and filter. */
  counted: NewsletterAudienceCount | undefined;
  /** A newer count is on its way: the one shown is for the previous choice. */
  stale: boolean;
  onList: (list: MarketingList) => void;
  onFilter: (filter: AudienceFilter) => void;
}) {
  const answers = status?.answers;
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4 text-sm">
      <div className="flex flex-col gap-3">
        <FilterRow label="Send to">
          <Segmented label="Send to" items={LIST_ITEMS} value={list} onChange={onList} />
        </FilterRow>
        <FilterRow label="Stage">
          <Segmented
            label="Stage"
            items={STAGE_ITEMS}
            value={filter.stage}
            onChange={(stage) => onFilter({ ...filter, stage })}
          />
        </FilterRow>
        <FilterRow label="Plan">
          <Segmented
            label="Plan"
            items={PLAN_ITEMS}
            value={filter.plan}
            onChange={(plan) => onFilter({ ...filter, plan })}
          />
        </FilterRow>
      </div>
      {/* Two lines kept whatever the filters say, so the box does not jump. */}
      <div aria-live="polite" className="flex min-h-11 flex-col gap-0.5">
        {counted === undefined ? (
          <Skeleton className="h-5 w-64 max-w-full" />
        ) : (
          <p
            data-testid="newsletter-audience"
            aria-busy={stale}
            className={stale ? "opacity-50 transition-opacity" : "transition-opacity"}
          >
            <span className="font-semibold tabular-nums">{fullNumber(counted.count)}</span>{" "}
            {audienceTail(counted.count, counted.list, counted.filter)}.
          </p>
        )}
        <p className="text-xs text-muted">
          Only people who opted in, verified their address and are not banned.
        </p>
      </div>
      {answers && (
        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          {MARKETING_LISTS.map((id) => (
            <ListAnswers key={id} list={id} answers={answers[id]} />
          ))}
        </div>
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
                {[MARKETING_LIST_LABELS[send.list], ...filterLabels(send.audience)].join(" · ")} ·{" "}
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
  const [list, setList] = useState<MarketingList>("news");
  const [filter, setFilter] = useState<AudienceFilter>(EVERYONE);
  const audience = useQuery(audienceQuery(list, filter));
  const count = audience.data?.count;
  const composer = useComposer(list, filter);
  const { busy, check, sendTest, sendAll, audienceChanged } = composer;
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
    <div className="flex max-w-2xl flex-col gap-5">
      <SectionHeading>Newsletter</SectionHeading>
      <Audience
        status={status}
        list={list}
        filter={filter}
        counted={audience.data}
        stale={audience.isPlaceholderData}
        onList={pickList}
        onFilter={pickFilter}
      />

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
          <Button type="submit" variant="primary" disabled={locked || reach === 0}>
            Send to {fullNumber(reach)}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        title="Send newsletter"
        open={confirming}
        onClose={() => busy === null && setConfirming(false)}
        onConfirm={() => void sendAll().then((sent) => sent && setConfirming(false))}
        confirmLabel={`Send to ${fullNumber(reach)}`}
        pending={busy === "send"}
      >
        <p>
          This emails {fullNumber(reach)} {audienceTail(reach, list, filter)}. It cannot be
          recalled.
        </p>
      </ConfirmDialog>

      <SendHistory sends={status?.sends ?? []} />
    </div>
  );
}
