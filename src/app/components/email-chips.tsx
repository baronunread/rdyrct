import { forwardRef, useId, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { X } from "@/app/ui/icons";
import { cn } from "../ui/cn";
import { isEmail, splitEmails } from "../lib/members-data";

/**
 * Several addresses in one box: each one becomes a chip as soon as a comma,
 * a space or Enter ends it, and a pasted list splits into chips at once.
 * Backspace in the empty input takes the last chip back out to edit.
 *
 * Built to sit where a Field would: the label row carries the reason on the
 * right when something is wrong, and nothing below the box moves.
 */
export const EmailChips = forwardRef<
  HTMLInputElement,
  {
    label: string;
    emails: string[];
    onChange: (emails: string[]) => void;
    /** The text not yet turned into a chip, owned by the caller so a submit
     * can count it too. */
    draft: string;
    onDraftChange: (draft: string) => void;
    error?: string;
    placeholder?: string;
  }
>(({ label, emails, onChange, draft, onDraftChange, error, placeholder }, ref) => {
  const inputId = useId();
  const reasonId = useId();
  const [focused, setFocused] = useState(false);

  const commit = (text: string) => {
    const next = splitEmails(text);
    if (next.length === 0) return;
    onChange(unique([...emails, ...next]));
    onDraftChange("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "," || e.key === ";" || e.key === " ") && draft.trim()) {
      e.preventDefault();
      commit(draft);
      return;
    }
    // Enter with text makes a chip; Enter on an empty input submits the form.
    if (e.key === "Enter" && draft.trim()) {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === "Backspace" && !draft && emails.length > 0) {
      e.preventDefault();
      const last = emails[emails.length - 1];
      onChange(emails.slice(0, -1));
      onDraftChange(last);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (splitEmails(text).length < 2) return;
    e.preventDefault();
    commit(`${draft} ${text}`);
  };

  return (
    <div className="min-w-0">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
        <label htmlFor={inputId}>{label}</label>
        {error && (
          <span id={reasonId} className="ml-auto truncate text-danger" title={error}>
            {error}
          </span>
        )}
      </span>
      {/* Clicking anywhere in the box puts the caret in the input, as a real
          field would. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the input inside is the keyboard target; this only forwards pointer clicks to it. */}
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget)
            document.getElementById(inputId)?.focus({ preventScroll: true });
        }}
        className={cn(
          "flex min-h-[76px] w-full cursor-text flex-wrap content-start items-center gap-1.5 rounded-lg bg-surface p-2 transition-[box-shadow] duration-150",
          focused
            ? "shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_oklab,var(--accent)_25%,transparent)]"
            : error
              ? "shadow-[0_0_0_1.5px_var(--danger)]"
              : "smooth-shadow-ring-xs",
        )}
      >
        {emails.map((email) => (
          <Chip
            key={email}
            email={email}
            bad={Boolean(error) && !isEmail(email)}
            onRemove={() => onChange(emails.filter((e) => e !== email))}
          />
        ))}
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens to type addresses; this is the first and main field.
          autoFocus
          value={draft}
          onChange={(e) => {
            const value = e.target.value;
            // A comma typed on a phone keyboard arrives here, not as a key.
            if (/[,;\s]$/.test(value)) commit(value);
            else onDraftChange(value);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit(draft);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? reasonId : undefined}
          placeholder={emails.length === 0 ? placeholder : "Add more, separated by commas"}
          className="h-7 min-w-[12rem] flex-1 bg-transparent px-1 font-mono text-[13px] text-text outline-none! placeholder:font-sans placeholder:text-sm placeholder:text-placeholder"
        />
      </div>
    </div>
  );
});
EmailChips.displayName = "EmailChips";

function Chip({ email, bad, onRemove }: { email: string; bad: boolean; onRemove: () => void }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-surface-2 pr-0.5 pl-2",
        bad && "text-danger shadow-[inset_0_0_0_1px_var(--danger)]",
      )}
    >
      <span className="truncate font-mono text-xs" title={email}>
        {email}
      </span>
      <button
        type="button"
        aria-label={`Remove ${email}`}
        onClick={onRemove}
        className="relative grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted transition-[background-color,color] duration-150 [@media(hover:hover)]:hover:bg-surface [@media(hover:hover)]:hover:text-text"
      >
        <X size={12} />
      </button>
    </span>
  );
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const key = e.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
