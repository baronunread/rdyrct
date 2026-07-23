import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

export function ConfirmDialog({
  title,
  open,
  onClose,
  onConfirm,
  confirmLabel,
  danger,
  pending,
  confirmDisabled,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  confirmDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        <div className="text-sm">{children}</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
