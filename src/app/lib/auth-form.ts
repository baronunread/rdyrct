import { useEffect, useState } from "react";

// The server surfaces raw schema errors like "[body.email] Invalid input";
// translate the ones a user can hit into our own copy.
export function friendlyAuthError(err: { code?: string; message?: string }): string {
  if (err.code === "PASSWORD_TOO_SHORT") return "Password must be at least 8 characters.";
  if (err.code === "PASSWORD_TOO_LONG") return "Password is too long.";
  if (err.code === "INVALID_TOKEN")
    return "This reset link is invalid or expired. Request a new one from the sign-in page.";
  if (err.code === "INVALID_EMAIL_DOMAIN") return "Enter a valid email address.";
  if (err.message?.includes("[body.email]")) return "Enter a valid email address.";
  return err.message ?? "Something went wrong";
}

/** Red flash + shake for a submit button when a check fails. Put `className`
 *  and `onAnimationEnd={end}` on the button; call `start()` on failure.
 *  Reduced-motion users never get an animationend event, so a timer also
 *  clears the red flash. */
export function useShake() {
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (!shaking) return;
    const t = setTimeout(() => setShaking(false), 500);
    return () => clearTimeout(t);
  }, [shaking]);
  return {
    start: () => setShaking(true),
    end: () => setShaking(false),
    className: shaking ? "!bg-danger motion-safe:animate-shake" : undefined,
  };
}
