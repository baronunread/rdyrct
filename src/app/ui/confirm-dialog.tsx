import type { ReactNode, RefObject } from "react";
import { Button } from "./button";
import { Dialog, type DialogSize } from "./dialog";
import { BusyContent } from "./spinner";
import { SOLID_DANGER } from "./solid-danger";

export function ConfirmDialog({
  title,
  open,
  onClose,
  onConfirm,
  confirmLabel,
  danger,
  pending,
  confirmDisabled,
  size,
  initialFocus,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  /** A solid danger button instead of the primary one. */
  danger?: boolean;
  pending?: boolean;
  confirmDisabled?: boolean;
  size?: DialogSize;
  /** Focus this on open instead of the close button (a typed check). */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size={size}
      initialFocus={initialFocus}
    >
      <div className="flex flex-col gap-4">
        <div className="text-sm">{children}</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            className={danger ? SOLID_DANGER : undefined}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            <BusyContent busy={!!pending}>{confirmLabel}</BusyContent>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
