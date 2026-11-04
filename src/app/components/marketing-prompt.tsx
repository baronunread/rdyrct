import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocation } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
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

/** One list's box in the dialog: its name, and what it sends under it. */
function ListBox({
  label,
  hint,
  checked,
  onChange,
  inputRef,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors duration-150 ease-out [@media(hover:hover)]:hover:bg-surface-2">
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

/**
 * The one-time "hear from rdyrct by email?" question, for an account that has
 * not answered. Two unticked boxes, one per list (product news, offers).
 * Every existing account starts there; one that answered at sign-up (ticked
 * or not) never sees it.
 *
 * Any answer ends it: Save with nothing ticked, "No thanks" and closing the
 * dialog are all a no to both lists. It never shows during the /welcome
 * setup flow. It also sends the sign-up form's remembered choice first
 * (lib/marketing.ts), and stays closed until that has landed, so a person who
 * just ticked a box is not asked again.
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
  const firstBox = useRef<HTMLInputElement>(null);

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
      initialFocus={firstBox}
    >
      <div className="flex flex-col gap-4">
        <div className="-mx-2 flex flex-col">
          <ListBox
            label="Product news"
            hint="New features and tips"
            checked={choice.news}
            onChange={(news) => setChoice((c) => ({ ...c, news }))}
            inputRef={firstBox}
          />
          <ListBox
            label="Offers"
            hint="Deals on paid plans"
            checked={choice.offers}
            onChange={(offers) => setChoice((c) => ({ ...c, offers }))}
          />
        </div>
        <p className="text-sm text-muted">Unsubscribe any time, from any email or in Settings.</p>
        <div className="flex justify-end gap-2">
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
