import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <BaseDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border-2 border-border bg-surface p-6 text-text shadow-2xl transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <BaseDialog.Title className="text-base font-bold">
              {title}
            </BaseDialog.Title>
            <BaseDialog.Close
              className="cursor-pointer rounded p-1 text-muted hover:text-text"
              aria-label="Close"
            >
              <X size={16} />
            </BaseDialog.Close>
          </div>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
