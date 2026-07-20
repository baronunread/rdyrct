import { useState } from "react";
import { Link } from "react-router";

// A notice, not a gate: rdyrct sets only a strictly-necessary session cookie,
// so there is nothing to opt out of; this just discloses it (GDPR/ePrivacy).
const KEY = "rdyrct:consent";

export function ConsentBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return true;
    }
  });
  if (dismissed) return null;
  const accept = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-xl border border-border bg-surface/95 p-4 text-xs text-muted shadow-xl backdrop-blur">
      <p className="leading-relaxed">
        rdyrct uses a single strictly-necessary cookie to keep you signed in,
        no tracking or advertising cookies. See our{" "}
        <Link to="/privacy" className="text-accent hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
      <button
        type="button"
        onClick={accept}
        className="mt-3 w-full cursor-pointer rounded-md border border-border px-3 py-1.5 hover:border-accent hover:text-text"
      >
        Got it
      </button>
    </div>
  );
}
