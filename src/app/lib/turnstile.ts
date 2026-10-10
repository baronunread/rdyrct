/**
 * Cloudflare Turnstile on the client (#304).
 *
 * The widget renders `interaction-only`: invisible unless Cloudflare wants a
 * click, in which case it shows itself in the corner. Work starts when the
 * visitor first touches the form, so the token is usually ready by the time
 * they submit.
 *
 * A failure here never blocks the form. The token goes to the server, the
 * server decides: an empty one is rejected when TURNSTILE_SECRET_KEY is set
 * and ignored when it is not.
 */
import { useCallback, useRef } from "react";
import { TURNSTILE_TOKEN_HEADER } from "@/shared/types";
import { useConfig } from "./hooks";
import { retryOnTurnstileFailure } from "./turnstile-retry";

export type TurnstileScope = "signup" | "password-reset" | "anon-link";

/** Runs a Turnstile-guarded request, re-solving once if the token is refused. */
export type TurnstileGuard = <T>(
  run: (headers: Record<string, string>) => Promise<T>,
) => Promise<T>;

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** How long to wait for a token before submitting without one. */
const SOLVE_TIMEOUT_MS = 20_000;

/** Tokens expire after 300s at Cloudflare; discard ours well before. */
const TOKEN_FRESH_MS = 4 * 60 * 1000;

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: "interaction-only";
      callback: (token: string) => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once, on demand. A failed load is not
 * remembered, so one dropped connection does not poison the tab. */
function loadScript(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing"));
    script.onerror = () => reject(new Error("turnstile failed to load"));
    document.head.appendChild(script);
  }).catch((cause: unknown) => {
    loading = null;
    throw cause;
  });
  return loading;
}

/** Resolves with a token, or "" if this browser could not produce one. "" is
 * deliberate rather than an exception: the server decides what an empty
 * token means. */
async function solve(siteKey: string, scope: TurnstileScope): Promise<string> {
  let container: HTMLElement | null = null;
  let widgetId: string | null = null;
  let turnstile: TurnstileApi | null = null;
  try {
    turnstile = await loadScript();
    const host = document.createElement("div");
    // Empty while invisible; if Cloudflare asks for a click, it appears here.
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:60";
    document.body.appendChild(host);
    container = host;
    return await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(""), SOLVE_TIMEOUT_MS);
      const done = (token: string) => {
        clearTimeout(timer);
        resolve(token);
      };
      widgetId = turnstile!.render(host, {
        sitekey: siteKey,
        action: scope,
        appearance: "interaction-only",
        callback: done,
        "error-callback": () => done(""),
        "timeout-callback": () => done(""),
      });
    });
  } catch {
    return "";
  } finally {
    if (widgetId) turnstile?.remove(widgetId);
    container?.remove();
  }
}

/**
 * A token for one form.
 *
 * `prime()` is safe to call on every keystroke and starts the work once;
 * hang it on the form's first input. `headers()` awaits whatever that
 * produced, so a fast typist waits and everyone else does not.
 *
 * A token is single-use, so the primed promise is cleared once spent: a form
 * submitted twice solves again rather than replaying a burned token.
 */
export function useTurnstile(scope: TurnstileScope) {
  const siteKey = useConfig().data?.turnstileSiteKey;
  const pending = useRef<{ token: Promise<string>; primedAt: number } | null>(null);

  const prime = useCallback(() => {
    if (!siteKey) return;
    const held = pending.current;
    if (held && Date.now() - held.primedAt < TOKEN_FRESH_MS) return;
    pending.current = { token: solve(siteKey, scope), primedAt: Date.now() };
  }, [scope, siteKey]);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    prime();
    const token = (await pending.current?.token) ?? "";
    pending.current = null;
    // The one place that knows "we could not run the check" from "the server
    // refused it".
    if (siteKey && !token) console.warn("turnstile_solve_failed", scope);
    return token ? { [TURNSTILE_TOKEN_HEADER]: token } : {};
  }, [prime, scope, siteKey]);

  const guarded = useCallback<TurnstileGuard>(
    (run) => retryOnTurnstileFailure(run, headers),
    [headers],
  );

  return { prime, headers, guarded };
}
