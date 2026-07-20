import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../ui/cn";
import { Tooltip } from "../ui/tooltip";

/** Centered card with the wordmark on top; wraps every auth screen. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-xl font-bold tracking-widest">
          <Link to="/" className="hover:text-accent">
            rdyrct
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

// What the password still lacks. Drives both the hover tips and the score,
// so the two cannot drift apart.
function passwordTips(pw: string): string[] {
  const tips: string[] = [];
  if (pw.length < 12) tips.push("Use 12 or more characters.");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw))
    tips.push("Mix upper and lower case.");
  if (!/\d/.test(pw)) tips.push("Add a number.");
  if (!/[^A-Za-z0-9]/.test(pw)) tips.push("Add a symbol.");
  return tips;
}

// Rough strength score, not entropy: length does most of the work, character
// variety nudges it up. 0 means below the 8-character minimum.
function passwordScore(pw: string): number {
  if (pw.length < 8) return 0;
  return Math.min(4, 5 - passwordTips(pw).length);
}

const METER = [
  { label: "Too short", fill: "bg-danger" },
  { label: "Weak", fill: "bg-danger" },
  { label: "Okay", fill: "bg-butter" },
  { label: "Good", fill: "bg-mint" },
  { label: "Strong", fill: "bg-mint" },
] as const;

/** Lives in the password field's hint slot; shows the plain "8+ characters"
 *  hint until the user types, then a 4-segment strength bar. The strength
 *  word is aria-only: sighted users read the fill, screen readers the label. */
export function PasswordMeter({ password }: { password: string }) {
  if (!password) return <>8+ characters</>;
  const score = passwordScore(password);
  const { label, fill } = METER[score];
  const filled = Math.max(score, 1);
  const tips = passwordTips(password);
  // Below the minimum the hard rule is the tip that matters; it replaces the
  // softer 12+ one (always first in the list while under 12).
  if (password.length < 8) tips[0] = "Use at least 8 characters.";
  return (
    <Tooltip
      content={
        tips.length ? (
          <ul className="flex flex-col gap-1">
            {tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        ) : (
          "Strong password. Nothing to add."
        )
      }
    >
      <span className="flex cursor-help items-center gap-2">
        {/* The visible label never changes; the level itself is aria-only, so
            screen readers hear "Strength Weak" while sighted users read the
            fill. */}
        <span className="shrink-0 underline decoration-dotted underline-offset-2">
          Strength
        </span>
        <span className="sr-only">{label}</span>
        <span aria-hidden className="flex flex-1 items-center gap-1">
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= filled ? fill : "bg-border",
              )}
            />
          ))}
        </span>
      </span>
    </Tooltip>
  );
}
