import { useEffect, useId, useRef, useState, type Ref } from "react";
import { useLocation } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogTitle } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { errorMessage } from "../lib/error-message";
import { useCurrentUser } from "../lib/hooks";
import {
  forgetSignupChoice,
  peekSignupChoice,
  useSetMarketing,
  type SignupChoice,
} from "../lib/marketing";

/** One list's row in the dialog: its name and what it sends on the left,
 * a switch on the right. The whole row is the target. Nothing saves until
 * Save. */
function ListRow({
  label,
  hint,
  checked,
  onChange,
  switchRef,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  switchRef?: Ref<HTMLButtonElement>;
}) {
  const hintId = useId();
  return (
    <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 ease-out [@media(hover:hover)]:hover:bg-surface-2/60">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      </span>
      <Switch
        ref={switchRef}
        label={label}
        describedBy={hintId}
        checked={checked}
        onCheckedChange={onChange}
      />
    </label>
  );
}

/**
 * The one-time "hear from rdyrct by email?" question, for an account that has
 * not answered. Two switches, both off, one per list (product news, offers).
 * Every existing account starts there; one that answered at sign-up (ticked
 * or not) never sees it.
 *
 * Any answer ends it: Save with both off, "No thanks" and closing the
 * dialog are all a no to both lists. It never shows during the /welcome
 * setup flow. It also sends the sign-up form's remembered choice first
 * (lib/marketing.ts), and stays closed until that has landed, so a person who
 * just ticked a box at sign-up is not asked again.
 */
export function MarketingPrompt() {
  const currentUser = useCurrentUser();
  const pathname = useLocation({ select: (l) => l.pathname });
  const toast = useToast();
  const set = useSetMarketing();
  // True while a sign-up choice waits to be sent or is on its way.
  const [flushing, setFlushing] = useState(() => peekSignupChoice() !== null);
  const [choice, setChoice] = useState<SignupChoice>({ news: false, offers: false });
  const [pressed, setPressed] = useState<"save" | "no" | null>(null);
  const firstSwitch = useRef<HTMLButtonElement>(null);

  const marketing = currentUser.data?.user.marketing;
  useEffect(() => {
    if (!flushing || !marketing) return;
    const remembered = peekSignupChoice();
    if (remembered === null || marketing.asked) {
      forgetSignupChoice();
      setFlushing(false);
      return;
    }
    // Forgotten only once it is saved. A failed save keeps the choice for the
    // next load and keeps the dialog shut meanwhile: closing the dialog would
    // record a no the person never gave.
    set.mutate(
      { source: "signup", ...remembered },
      {
        onSuccess: () => {
          forgetSignupChoice();
          setFlushing(false);
        },
      },
    );
    // `set` is a new object each render; the guard above is what runs this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushing, marketing]);

  const open =
    Boolean(marketing && !marketing.asked) && !flushing && !pathname.startsWith("/welcome");

  const answer = (kind: "save" | "no") => {
    setPressed(kind);
    const lists = kind === "save" ? choice : { news: false, offers: false };
    set.mutate(
      { source: "prompt", ...lists },
      { onError: (error) => toast(errorMessage(error), "error") },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !set.isPending && answer("no")}
      title="Hear from rdyrct by email?"
      size="sm"
      bare
      initialFocus={firstSwitch}
    >
      <div className="flex flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <DialogTitle className="text-lg">Hear from rdyrct by email?</DialogTitle>
          <DialogClose className="-m-1.5" />
        </div>
        <p className="mt-1 text-sm text-pretty text-muted">
          Choose what you want. Each stays off until you turn it on.
        </p>
        <div className="mt-5 overflow-hidden rounded-xl bg-surface smooth-shadow-ring-xs [&>*+*]:shadow-[inset_0_1px_0_var(--border)]">
          <ListRow
            label="Product news"
            hint="New features and tips"
            checked={choice.news}
            onChange={(news) => setChoice((c) => ({ ...c, news }))}
            switchRef={firstSwitch}
          />
          <ListRow
            label="Offers"
            hint="Deals on paid plans"
            checked={choice.offers}
            onChange={(offers) => setChoice((c) => ({ ...c, offers }))}
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          Unsubscribe any time, from any email or in Settings.
        </p>
        <div className="mt-6 flex justify-end gap-2 max-sm:[&>*]:flex-1">
          <Button variant="ghost" disabled={set.isPending} onClick={() => answer("no")}>
            <BusyContent busy={set.isPending && pressed === "no"}>No thanks</BusyContent>
          </Button>
          <Button variant="primary" disabled={set.isPending} onClick={() => answer("save")}>
            <BusyContent busy={set.isPending && pressed === "save"}>Save</BusyContent>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
