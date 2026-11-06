/**
 * Schedule, beside Send now: a date and time in the admin's own time zone,
 * said back in words before it is set. The send itself waits in a Cloudflare
 * Workflow (worker/newsletter-send.ts) until then.
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { buttonClass } from "../../ui/button-class";
import { Button } from "../../ui/button";
import { Field, Input } from "../../ui/field";
import { BusyContent } from "../../ui/spinner";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** "Thursday 6 November at 09:00". */
export function whenWords(at: number): string {
  const parts = WHEN.formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} at ${part("hour")}:${part("minute")}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local time as a datetime-local input holds it. */
function inputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Tomorrow at 9 in the morning, local: where the picker starts. */
function tomorrowMorning(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return inputValue(date);
}

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The input's value as epoch ms, read as local time; null when empty. */
function parseLocal(value: string): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? null : at;
}

export function SchedulePicker({
  disabled,
  busy,
  onOpen,
  onSchedule,
}: {
  disabled: boolean;
  busy: boolean;
  /** Checks the issue; false keeps the picker shut so the marked fields show. */
  onOpen: () => boolean;
  /** Schedules the send; resolves true once it is stored. */
  onSchedule: (at: number) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(tomorrowMorning);
  const [error, setError] = useState<string | undefined>();
  const at = parseLocal(value);
  const submit = async () => {
    if (at === null) return setError("Pick a date and time");
    if (at <= Date.now()) return setError("Pick a time in the future");
    if (await onSchedule(at)) setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next && !onOpen()) return;
        setError(undefined);
        setOpen(next);
      }}
    >
      <Popover.Trigger disabled={disabled} className={buttonClass({ variant: "outline" })}>
        Schedule
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" collisionPadding={8} className="z-50">
          <Popover.Popup className="flex w-[min(320px,calc(100vw-1.5rem))] origin-[var(--transform-origin)] flex-col gap-3 rounded-xl bg-surface p-4 smooth-shadow-ring-xl transition-[opacity,scale,filter] duration-150 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:blur-[4px] data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <Popover.Title className="text-sm font-semibold">Schedule the send</Popover.Title>
            {/* Not a form: in React's tree this sits inside the composer's. */}
            <div className="flex flex-col gap-3">
              <Field label="Date and time" error={error}>
                <Input
                  type="datetime-local"
                  value={value}
                  min={inputValue(new Date())}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void submit();
                  }}
                />
              </Field>
              <Popover.Description className="min-h-8 text-xs text-pretty text-muted">
                {at === null ? "Pick when it goes." : `Goes ${whenWords(at)}, your time (${ZONE}).`}
              </Popover.Description>
              <Button variant="primary" disabled={busy} onClick={() => void submit()}>
                <BusyContent busy={busy}>Schedule send</BusyContent>
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
