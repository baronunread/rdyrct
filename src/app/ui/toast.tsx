import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "./cn";

interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

const ToastContext = createContext<(message: string, kind?: Toast["kind"]) => void>(
  () => {},
);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "rounded-lg border bg-surface px-4 py-2.5 text-sm shadow-xl",
              t.kind === "error"
                ? "border-danger/50 text-danger"
                : "border-border text-text",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
