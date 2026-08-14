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
import { CAP_TOKEN_HEADER } from "@/shared/types";
import { retryOnCapFailure } from "./cap-retry";

export type CapScope = "signup" | "password-reset";

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
 * The widget for one scope, made once and left in the document.
 *
 * This is the shape Cap's own `Cap` class uses, and the reason matters: the
 * element's `disconnectedCallback` aborts its AbortController, and every
 * `await` inside the widget's `solve()` is followed by
 * `if (signal?.aborted || !this.#speculative) return;`. So a widget removed
 * while it is working makes `solve()` resolve **undefined**: no token, no
 * throw, no error event. The old code created a throwaway element per solve
 * and removed it in a `finally`, which is exactly how to hit that path, and
 * an undefined result became an empty token, no `x-cap-token` header, and
 * "could not verify you are human" in front of somebody trying to sign up.
 */
const widgets = new Map<CapScope, CapElement>();

/** One solve at a time per widget. `solve()` opens with
 * `if (this.#solving) return;`, so a second concurrent call on the same
 * element resolves undefined too. Callers share the in-flight promise
 * instead. */
const solving = new Map<CapScope, Promise<string>>();

async function widgetFor(scope: CapScope): Promise<CapElement> {
  await loadCap();
  const existing = widgets.get(scope);
  if (existing?.isConnected) return existing;

  const el = document.createElement("cap-widget") as CapElement;
  el.setAttribute("data-cap-api-endpoint", `/api/cap/${scope}/`);
  el.setAttribute("aria-hidden", "true");
  el.style.display = "none";
  // The widget dispatches its own "error" event, and with nothing listening
  // it surfaces as an unhandled error: an aborted solve would otherwise look
  // like a page crash. Failure is reported by resolving with "".
  el.addEventListener("error", (event) => event.stopPropagation());
  document.documentElement.appendChild(el);
  widgets.set(scope, el);
  return el;
}

/** Throws the widget away, for the cases where its internal state is not
 * worth trusting: it is rebuilt on the next attempt. */
function discardWidget(scope: CapScope): void {
  widgets.get(scope)?.remove();
  widgets.delete(scope);
}

/**
 * Solves one challenge and resolves with the token, or "" if this browser
 * could not produce one.
 *
 * "" is deliberate rather than an exception: a visitor whose browser cannot
 * run the puzzle should still be able to submit and be answered by the
 * server, instead of meeting a form that refuses to do anything.
 *
 * A solve that comes back without a token is retried once on a fresh widget.
 * The silent-undefined paths above are all transient (an abort, a solve
 * already running), so the second attempt is usually the one that works, and
 * a second failure is a real one worth reporting.
 */
function solveCap(scope: CapScope): Promise<string> {
  const inFlight = solving.get(scope);
  if (inFlight) return inFlight;

  const attempt = (async () => {
    try {
      for (let tries = 0; tries < 2; tries++) {
        const el = await widgetFor(scope);
        // Single-use tokens: whatever this widget still holds from the last
        // solve has been spent, and reset() clears it along with the timer
        // that would have cleared it later.
        el.reset();
        const result = await Promise.race([
          el.solve(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), SOLVE_TIMEOUT_MS)),
        ]);
        if (result?.token) return result.token;
        // Either it timed out, or it returned without one. Both leave state
        // this widget cannot be trusted with, so the retry gets a new one.
        discardWidget(scope);
      }
      return "";
    } catch {
      discardWidget(scope);
      return "";
    } finally {
      solving.delete(scope);
    }
  })();

  solving.set(scope, attempt);
  return attempt;
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

  const guarded = useCallback(
    <T>(run: (headers: Record<string, string>) => Promise<T>) => retryOnCapFailure(run, headers),
    [headers],
  );

  return { prime, headers, guarded };
}
