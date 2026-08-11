/**
 * Cap on the client (#98): proof-of-work, solved without a checkbox.
 *
 * Cap ships a visible widget, but its element also exposes `solve()`, so we
 * keep the element out of sight and drive it ourselves: work starts when the
 * visitor first touches the form and the token is usually ready by the time
 * they submit. Nobody clicks anything, and nobody waits on a spinner they
 * did not ask for.
 *
 * Everything is served from our own origin. The widget is bundled from npm
 * rather than pulled from Cap's CDN, and the WASM solver comes through Vite
 * as a hashed asset, so `script-src 'self'` and `connect-src 'self'` already
 * cover both. Loading either from a CDN would hand back the third-party
 * runtime dependency that is the whole reason we chose Cap over Turnstile.
 *
 * A failure here never blocks the form. The token goes to the server, the
 * server decides: an empty one is rejected when CAP_SECRET is set and
 * ignored when it is not, which is what keeps local dev and CI quiet.
 */
import { useCallback, useRef } from "react";
import wasmUrl from "@cap.js/wasm/browser/cap_wasm_bg.wasm?url";
import { CAP_FAILED_CODE, CAP_TOKEN_HEADER } from "@/shared/types";

export type CapScope = "signup" | "password-reset" | "anon-link";

/** Runs a Cap-guarded request, re-solving once if the token is refused. */
export type CapGuard = <T>(run: (headers: Record<string, string>) => Promise<T>) => Promise<T>;

/** How long to wait for a solve before giving up and submitting without one. */
const SOLVE_TIMEOUT_MS = 20_000;

/**
 * How long a solved token is reused before it is thrown away and solved
 * again. Comfortably under the ten minutes the Worker keeps a redeemed token,
 * so a form filled slowly still submits with something the server will
 * accept.
 */
const TOKEN_FRESH_MS = 4 * 60 * 1000;

type CapElement = HTMLElement & {
  solve: () => Promise<{ token?: string }>;
  reset: () => void;
};

let loading: Promise<void> | null = null;

/**
 * Loads the widget once, on demand, so it stays out of the initial bundle.
 *
 * A failed load is not remembered. The promise used to be cached whatever it
 * settled to, so one bad fetch (a dev server restarting under an open tab, a
 * dropped connection, a chunk that 404s after a deploy) poisoned every solve
 * for the life of that tab: the form then said "could not verify you are
 * human" forever, and only a reload fixed it. Now the next attempt tries
 * again.
 */
function loadCap(): Promise<void> {
  loading ??= (async () => {
    // Read at module-eval time by the widget, so it has to be set first, or
    // it fetches the WASM from jsdelivr and trips the CSP.
    (window as unknown as { CAP_CUSTOM_WASM_URL?: string }).CAP_CUSTOM_WASM_URL = wasmUrl;
    await import("@cap.js/widget");
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Starts solving a challenge for `scope` and resolves with the token.
 *
 * Resolves with "" on any failure, including a timeout. That is deliberate:
 * a visitor whose browser cannot solve the puzzle should still be able to
 * try, and be turned away by the server with a message, rather than face a
 * form that silently refuses to submit.
 */
function solveCap(scope: CapScope): Promise<string> {
  return (async () => {
    try {
      await loadCap();
      const el = document.createElement("cap-widget") as CapElement;
      el.setAttribute("data-cap-api-endpoint", `/api/cap/${scope}/`);
      // Out of the layout entirely, not `display: none`: the widget skips
      // its own background work when it believes it is invisible, and we
      // want it working.
      el.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;opacity:0";
      el.setAttribute("aria-hidden", "true");
      // The widget dispatches its own "error" event and, with nothing
      // listening, it surfaces as an unhandled error: a navigation that
      // aborts an in-flight solve would otherwise look like a page crash.
      // We already report failure by resolving with "".
      el.addEventListener("error", (event) => event.stopPropagation());
      document.body.appendChild(el);
      try {
        const result = await Promise.race([
          el.solve(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), SOLVE_TIMEOUT_MS)),
        ]);
        return result?.token ?? "";
      } finally {
        el.remove();
      }
    } catch {
      return "";
    }
  })();
}

/** The header a solved token travels in, ready to spread into fetch options. */
function capHeaders(token: string): Record<string, string> {
  return token ? { [CAP_TOKEN_HEADER]: token } : {};
}

/**
 * A token for one form.
 *
 * `prime()` is safe to call on every keystroke and starts the work once;
 * hang it on the form's first focus so the puzzle is solving while the
 * visitor types. `headers()` awaits whatever that produced, so a fast
 * typist waits and everyone else does not.
 *
 * A token is single-use, so the primed promise is cleared once spent: a
 * form submitted twice (a failed signup, then a corrected one) solves
 * again rather than replaying a token the server has already burned.
 */
export function useCap(scope: CapScope) {
  const pending = useRef<{ token: Promise<string>; primedAt: number } | null>(null);

  const prime = useCallback(() => {
    // Discarded once stale, not just once spent. The server keeps a redeemed
    // token for ten minutes; the browser was holding one forever, so filling
    // the form and submitting after a distraction failed with "could not
    // verify you are human" and no way to tell why. Re-solving costs about
    // 25ms.
    const held = pending.current;
    if (held && Date.now() - held.primedAt < TOKEN_FRESH_MS) return;
    pending.current = { token: solveCap(scope), primedAt: Date.now() };
  }, [scope]);

  const headers = useCallback(async () => {
    prime();
    const token = await pending.current!.token;
    // Single-use: a second submit has to solve again rather than replay a
    // token the server has already burned.
    pending.current = null;
    // An empty token means the puzzle never got solved here: the widget or
    // its WASM did not load, or it ran out of time. The request still goes
    // (the server decides, and Cap may be off entirely), but this is the one
    // place that knows the difference between "we could not run the check"
    // and "the server refused it", and saying so beats reading the network
    // tab of somebody else's browser.
    if (!token) console.warn("cap_solve_failed", scope);
    return capHeaders(token);
  }, [prime, scope]);

  /**
   * Runs a Cap-guarded request, and if the Worker refuses the token, solves
   * a fresh one and runs it exactly once more.
   *
   * A token can be refused for reasons the browser cannot see coming: it
   * expired, it was already spent, or the server forgot it. None of those
   * are the visitor's doing and none of them are worth an error message, so
   * proving ourselves again is the honest response. Once, not in a loop: a
   * second refusal means something is actually wrong, and that one belongs
   * on screen.
   */
  const guarded = useCallback(
    async <T>(run: (headers: Record<string, string>) => Promise<T>): Promise<T> => {
      const first = await run(await headers());
      if (!isCapFailure(first)) return first;
      return run(await headers());
    },
    [headers],
  );

  return { prime, headers, guarded };
}

/**
 * Whether a result is the Worker turning down a Cap token.
 *
 * Covers both shapes this app gets back: better-auth returns `{ error }` on
 * the object rather than throwing, and api() rejects with an ApiError whose
 * `.code` comes from the response body.
 */
function isCapFailure(result: unknown): boolean {
  const error = (result as { error?: { code?: string } } | null)?.error;
  return error?.code === CAP_FAILED_CODE;
}
