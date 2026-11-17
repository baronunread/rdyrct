import { useRef, useState } from "react";
import { COMP_PLANS } from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import type { AdminUserRow } from "@/shared/types";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";
import { Field, Input, Select } from "../../ui/field";
import { BusyContent } from "../../ui/spinner";

export type CompPlan = "hobby" | "pro";

/** A comp is recorded with who, when and why (#81); the reason is required. */
export function GrantCompDialog({
  user,
  onClose,
  onGrant,
  pending,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onGrant: (plan: CompPlan, reason: string) => void;
  pending: boolean;
}) {
  const [plan, setPlan] = useState<CompPlan>(user.compPlan ?? "pro");
  const [reason, setReason] = useState(user.compReason ?? "");
  const [missing, setMissing] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);
  const trimmed = reason.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={`Comp ${user.name}`}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) {
            setMissing(true);
            reasonRef.current?.focus();
            return;
          }
          onGrant(plan, trimmed);
        }}
      >
        <p className="text-sm text-pretty text-muted">
          Gives {user.name} paid access without a subscription. It covers every org they own, it
          counts in plan totals, and it never counts as revenue. A subscription they buy later sits
          underneath and comes back if the comp is revoked.
        </p>
        <Field label="Plan">
          <Select
            value={plan}
            onChange={(e) => setPlan(oneOf(COMP_PLANS, e.target.value, "hobby"))}
          >
            <option value="hobby">Hobby</option>
            <option value="pro">Pro</option>
          </Select>
        </Field>
        <Field
          label="Reason"
          hint="Recorded with your name and shown in this list."
          error={missing ? "Required" : undefined}
        >
          <Input
            ref={reasonRef}
            value={reason}
            maxLength={500}
            placeholder="Design partner, launch giveaway, support goodwill…"
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setMissing(false);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            <BusyContent busy={pending}>{user.compPlan ? "Update comp" : "Grant comp"}</BusyContent>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
