import { useCallback, useEffect, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { BaseUIEvent } from "@base-ui/react/types";
import { Toast } from "@base-ui/react/toast";
import { Check, X } from "@/app/ui/icons";
import { cn } from "./cn";

// A standalone manager, not context state, so call sites that just push a toast don't
// re-render on every add/dismiss elsewhere.
type ToastData = {
  detail?: string;
  code?: string;
};
const manager = Toast.createToastManager<ToastData>();

type ToastKind = "info" | "error";

export interface ToastOptions {
  detail?: string;
  code?: string;
  action?: { label: string; onClick: () => void };
}

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
      timeout: options?.action || options?.detail ? 5000 : undefined,
    });
  }, []);
}

// Base UI pauses toasts on the viewport's mouseenter and mousemove, which the browser sends
// with no movement when a toast appears under a resting cursor, keeping it on screen.
// Until the mouse really moves the viewport ignores them.
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
