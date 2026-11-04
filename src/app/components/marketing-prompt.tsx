import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { errorMessage } from "../lib/error-message";
import { useCurrentUser } from "../lib/hooks";
import { forgetSignupChoice, peekSignupChoice, useSetMarketing } from "../lib/marketing";

/**
 * The one-time "email me product news?" question, for an account that has not
 * answered. Every existing account starts there; one that answered at sign-up
 * (ticked or not) never sees it.
 *
 * Any answer ends it, closing the dialog counts as "no", and it never shows
 * during the /welcome setup flow. It also sends the sign-up form's remembered
 * choice first (lib/marketing.ts), and stays closed until that has landed, so
 * a person who just ticked the box is not asked again.
 */
export function MarketingPrompt() {
  const currentUser = useCurrentUser();
  const pathname = useLocation({ select: (l) => l.pathname });
  const toast = useToast();
  const set = useSetMarketing();
  // True while a sign-up choice waits to be sent or is on its way.
  const [flushing, setFlushing] = useState(() => peekSignupChoice() !== null);

  const marketing = currentUser.data?.user.marketing;
  useEffect(() => {
    if (!flushing || !marketing) return;
    const optIn = peekSignupChoice();
    forgetSignupChoice();
    if (optIn === null || marketing.asked) {
      setFlushing(false);
      return;
    }
    set.mutate({ optIn, source: "signup" }, { onSettled: () => setFlushing(false) });
    // `set` is a new object each render; the guard above is what runs this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushing, marketing]);

  const open =
    Boolean(marketing && !marketing.asked) && !flushing && !pathname.startsWith("/welcome");

  const answer = (optIn: boolean) =>
    set.mutate(
      { optIn, source: "prompt" },
      { onError: (error) => toast(errorMessage(error), "error") },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !set.isPending && answer(false)}
      title="Product news by email?"
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          New features and tips, now and then. Unsubscribe any time, from any email or in Settings.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={set.isPending} onClick={() => answer(false)}>
            No thanks
          </Button>
          <Button variant="primary" disabled={set.isPending} onClick={() => answer(true)}>
            <BusyContent busy={set.isPending && set.variables?.optIn === true}>
              Yes, email me
            </BusyContent>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
