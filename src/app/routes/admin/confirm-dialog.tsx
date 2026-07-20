import type { ReactNode } from "react";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";

/** Single confirmation popup for every destructive/privileged row action. */
export function ConfirmDialog({
  title,
  open,
  onClose,
  onConfirm,
  confirmLabel,
  danger,
  pending,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">{children}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
