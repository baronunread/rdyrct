import { useCallback, type ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";
import { X } from "@/app/ui/icons";
import { cn } from "./cn";

// A standalone manager, not context state, so the many call sites that just
// want to push a toast don't subscribe to the toast list and re-render on
// every add/dismiss elsewhere in the app.
const manager = Toast.createToastManager();

export function useToast() {
  return useCallback((message: string, kind: "info" | "error" = "info") => {
    manager.add({ description: message, type: kind });
  }, []);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={manager} limit={4} timeout={3250}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="toast-stack pointer-events-none fixed bottom-4 z-toast">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast, index) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      swipeDirection="down"
      className={cn(
        "rdyrct-toast rounded-lg border bg-surface px-4 py-2.5 pr-10 text-sm shadow-xl",
        toast.type === "error" ? "border-danger/50 text-danger" : "border-border text-text",
      )}
    >
      <Toast.Description />
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
  ));
}
