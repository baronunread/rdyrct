import { useCallback, useEffect, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { BaseUIEvent } from "@base-ui/react/types";
import { Toast } from "@base-ui/react/toast";
import { Check, X } from "@/app/ui/icons";
import { cn } from "./cn";

// A standalone manager, not context state, so the many call sites that just
// want to push a toast don't subscribe to the toast list and re-render on
// every add/dismiss elsewhere in the app.
type ToastData = {
  /** A muted second line: what to do next, or the reason. */
  detail?: string;
  /** An identifier set in mono after the message: "Copied <url>". */
  code?: string;
};
const manager = Toast.createToastManager<ToastData>();

type ToastKind = "info" | "error";

export interface ToastOptions {
  /** A muted second line under the message. */
  detail?: string;
  /** An identifier (a short link, a domain) shown in mono after the message. */
  code?: string;
  /** One button on the right, like "Open". Pressing it closes the toast. */
  action?: { label: string; onClick: () => void };
}

/**
 * `toast("Link created")`, `toast("Could not save", "error")`, and with the
 * optional third argument a second line, an identifier in mono, or one
 * action button: `toast("Link created", "info", { action: { label: "Open",
 * onClick } })`.
 */
export function useToast() {
  return useCallback((message: string, kind: ToastKind = "info", options?: ToastOptions) => {
    let id = "";
    movedSinceToast = false;
    id = manager.add({
      description: message,
      type: kind,
      data: { detail: options?.detail, code: options?.code },
      actionProps: options?.action
        ? {
            children: options.action.label,
            onClick: () => {
              options.action?.onClick();
              manager.close(id);
            },
          }
        : undefined,
      // An error with a second line, or one that offers an action, needs a
      // little longer to read than "Copied".
      timeout: options?.action || options?.detail ? 5000 : undefined,
    });
  }, []);
}

/**
 * Whether the mouse has really moved since the last toast appeared. Base UI
 * pauses toasts on the viewport's mouseenter and mousemove, and the browser
 * sends those, with no movement, when a toast appears under a cursor that is
 * resting there. That kept a toast on screen until the mouse moved off it.
 * Until the mouse moves, the viewport ignores them; a real hover still
 * pauses, so somebody reading a toast keeps it.
 */
let movedSinceToast = true;

function useTrackPointerMoves() {
  useEffect(() => {
    const moved = (e: MouseEvent) => {
      if (e.movementX || e.movementY) movedSinceToast = true;
    };
    window.addEventListener("mousemove", moved, { passive: true });
    return () => window.removeEventListener("mousemove", moved);
  }, []);
}

/** Base UI's hover pause, only for a mouse that moved there. */
function skipHoverUntilMoved(event: BaseUIEvent<ReactMouseEvent<HTMLDivElement>>) {
  if (!movedSinceToast) event.preventBaseUIHandler();
}
export function ToastProvider({ children }: { children: ReactNode }) {
  useTrackPointerMoves();
  return (
    <Toast.Provider toastManager={manager} limit={4} timeout={3250}>
      {children}
      <Toast.Portal>
        <Toast.Viewport
          className="toast-stack pointer-events-none fixed bottom-4 z-toast"
          onMouseEnter={skipHoverUntilMoved}
          onMouseMove={skipHoverUntilMoved}
        >
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

/** ✓ in mint for an outcome, × in the danger colour for a failure. The word
 * carries the meaning; the mark only helps the eye find it. */
function ToastMark({ error }: { error: boolean }) {
  return (
    <span
      aria-hidden
      data-toast-mark={error ? "error" : "ok"}
      className={cn("grid size-5 shrink-0 place-items-center", error ? "text-danger" : "text-mint")}
    >
      {error ? <X size={16} strokeWidth={2.25} /> : <Check size={16} strokeWidth={2.25} />}
    </span>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager<ToastData>();
  return toasts.map((toast, index) => {
    const error = toast.type === "error";
    const detail = toast.data?.detail;
    const code = toast.data?.code;
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        swipeDirection="down"
        className={cn(
          "rdyrct-toast flex min-h-11 gap-2.5 rounded-xl bg-surface py-2.5 pr-10 pl-3.5 text-sm text-text smooth-shadow-ring-xl",
          detail ? "items-start" : "items-center",
        )}
      >
        <ToastMark error={error} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Toast.Description>
            {toast.description}
            {code && (
              <>
                {" "}
                <span className="font-mono text-[0.8125rem] [overflow-wrap:anywhere]">{code}</span>
              </>
            )}
          </Toast.Description>
          {detail && <p className="text-xs text-muted">{detail}</p>}
        </div>
        {toast.actionProps && (
          <Toast.Action className="-my-1 h-8 shrink-0 cursor-pointer rounded-lg px-2.5 text-sm font-medium text-text transition-[background-color,scale] duration-200 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-surface-2" />
        )}
        <Toast.Close
          className={cn("rdyrct-toast-close", index === 0 && "rdyrct-toast-close-front")}
          aria-label="Dismiss notification"
        >
          {index === 0 && (
            <svg className="rdyrct-toast-timer" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" pathLength="1" />
            </svg>
          )}
          <X size={12} strokeWidth={2.25} aria-hidden="true" />
        </Toast.Close>
      </Toast.Root>
    );
  });
}
