import { useEffect, useEffectEvent, useRef } from "react";
import { OTPField } from "@base-ui/react/otp-field";
import { cn } from "./cn";

function focusSlot(root: HTMLDivElement | null, index: number) {
  root?.querySelectorAll<HTMLInputElement>("input")[index]?.focus();
}

/**
 * Segmented one-time-code input (the modern boxed style). Wraps Base UI's
 * OTPField: numeric validation, paste-to-fill, and arrow-key nav come for
 * free. `onComplete` fires once the last slot is filled.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus,
  disabled,
  onComplete,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  onComplete?: (value: string) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wasDisabled = useRef(disabled);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    // Base UI's inputs blur themselves while disabled (e.g. mid-verify) and
    // don't reclaim focus once re-enabled, so a failed attempt otherwise
    // leaves the keyboard pointed at nothing.
    if (wasDisabled.current && !disabled) {
      focusSlot(rootRef.current, Math.min(valueRef.current.length, length - 1));
    }
    wasDisabled.current = disabled;
  }, [disabled, length]);

  const handleDigit = useEffectEvent((next: string) => {
    onChange(next);
    if (next.length === length) onComplete?.(next);
  });

  useEffect(() => {
    // Typing a digit anywhere on the page (not just clicking into a box
    // first) jumps into the next empty slot, so an interruption elsewhere
    // (clicking away, tabbing out and back) doesn't force a re-click.
    if (disabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!/^[0-9]$/.test(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
      const root = rootRef.current;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!root || !target || root.contains(target)) return;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (valueRef.current.length >= length) return;
      event.preventDefault();
      const next = valueRef.current + event.key;
      // Update the ref immediately, not just on the next render: back-to-back
      // keydowns in the same tick (fast typing, a paste-like burst) would
      // otherwise all read the same stale value and clobber each other.
      valueRef.current = next;
      handleDigit(next);
      focusSlot(root, Math.min(next.length, length - 1));
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [disabled, length]);

  return (
    <OTPField.Root
      ref={rootRef}
      length={length}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        onChange(next);
        if (next.length === length) onComplete?.(next);
      }}
      className={cn("flex gap-2", className)}
    >
      {Array.from({ length }).map((_, i) => (
        <OTPField.Input
          key={i}
          autoFocus={autoFocus && i === 0}
          className="h-11 w-full min-w-0 rounded-md border border-border bg-bg text-center text-lg text-text tabular-nums transition-colors focus:border-accent focus:outline-none disabled:opacity-50 data-[filled]:border-accent/60"
        />
      ))}
    </OTPField.Root>
  );
}
