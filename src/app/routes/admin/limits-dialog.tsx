import { useState } from "react";
import * as v from "valibot";
import { limitOverridesSchema } from "@/shared/limits";
import { PLAN_LIMITS, type AdminUserRow, type LimitOverrides } from "@/shared/types";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";
import { Switch } from "../../ui/switch";
import { Field, Input } from "../../ui/field";
import { BusyContent } from "../../ui/spinner";

/** The numeric limits an admin can set, in the order the dialog shows them. */
const NUMBER_FIELDS = [
  ["orgs", "Organizations owned"],
  ["links", "Links"],
  ["members", "Members"],
  ["domains", "Custom domains"],
  ["analyticsDays", "Analytics days"],
  ["trackedClicks", "Clicks counted a month"],
] as const;

type NumberKey = (typeof NUMBER_FIELDS)[number][0];
type Drafts = Partial<Record<NumberKey, string>>;
type Errors = Partial<Record<NumberKey, string>>;

/** Whether a draft is empty (the plan's value) or a number the schema accepts. */
function draftError(key: NumberKey, text: string): string | undefined {
  if (!text.trim()) return undefined;
  const parsed = v.safeParse(limitOverridesSchema.entries[key], Number(text));
  return parsed.success ? undefined : "Whole number, too low or high";
}

/** The note saved with the limits, and who saved them last. */
function NoteField({
  value,
  setBy,
  onChange,
}: {
  value: string;
  setBy: string | null;
  onChange: (note: string) => void;
}) {
  return (
    <Field label="Note" hint={setBy ? `Last set by ${setBy}.` : "Saved with these limits."}>
      <Input
        value={value}
        maxLength={200}
        placeholder="Acme, $199/mo yearly"
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** The overrides the drafts spell, and the reason each bad one is bad. */
type Collected = { overrides: LimitOverrides; errors: Errors };

function collect(read: (key: NumberKey) => string): Collected {
  const overrides: LimitOverrides = {};
  const errors: Errors = {};
  for (const [key] of NUMBER_FIELDS) {
    const text = read(key).trim();
    const error = draftError(key, text);
    if (error) errors[key] = error;
    else if (text) overrides[key] = Number(text);
  }
  return { overrides, errors };
}

/**
 * Enterprise is handled by hand: an admin sets custom limits for one account.
 * An empty field uses the plan's value, and a custom value only ever raises
 * it, so one below the plan's changes nothing. They apply while the account is
 * on a paid plan.
 */
export function LimitsDialog({
  user,
  onClose,
  onSave,
  pending,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onSave: (overrides: LimitOverrides | null, note: string) => void;
  pending: boolean;
}) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [note, setNote] = useState(user.limitNote ?? "");
  const [qrCustom, setQrCustom] = useState(user.limitOverrides?.qrCustom ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const plan = PLAN_LIMITS[user.plan];
  // What a field shows: what was typed, else what is stored.
  const valueOf = (key: NumberKey) => drafts[key] ?? user.limitOverrides?.[key]?.toString() ?? "";

  const submit = () => {
    const { overrides, errors: found } = collect(valueOf);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (qrCustom) overrides.qrCustom = true;
    onSave(Object.keys(overrides).length ? overrides : null, note.trim());
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Custom limits for ${user.name}`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-sm text-muted">
          Empty fields keep the plan's value, and a custom value can only raise it. On a paid or
          comped plan these limits make the account Enterprise. On Free they are kept but do not
          count.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {NUMBER_FIELDS.map(([key, label]) => (
            <Field key={key} label={label} error={errors[key]}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={valueOf(key)}
                placeholder={String(plan[key])}
                onChange={(e) => {
                  setDrafts({ ...drafts, [key]: e.target.value });
                  setErrors({ ...errors, [key]: undefined });
                }}
              />
            </Field>
          ))}
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">Logo and colors on QR codes, whatever the plan</span>
          <Switch label="Custom QR codes" checked={qrCustom} onCheckedChange={setQrCustom} />
        </div>
        <NoteField value={note} setBy={user.limitSetBy} onChange={setNote} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={pending}>
            <BusyContent busy={pending}>Save</BusyContent>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
