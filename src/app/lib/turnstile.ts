/**
 * Cloudflare Turnstile on the client (#304).
 *
 * The widget renders `interaction-only`: invisible unless Cloudflare wants a
 * click. When it does, the challenge appears in the form's own slot
 * (`TurnstileSlot`, just above the submit button) at the form's width and in
 * the app's theme, and `needsClick` tells the button to say so. Work starts
 * when the visitor first touches the form, so the token is usually ready by
 * the time they submit.
 *
 * A failure here never blocks the form. The token goes to the server, the
 * server decides: an empty one is rejected when TURNSTILE_SECRET_KEY is set
 * and ignored when it is not.
 */
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { TURNSTILE_TOKEN_HEADER } from "@/shared/types";
import { configQuery, useConfig } from "./hooks";
import { currentTheme } from "./theme";
import { retryOnTurnstileFailure } from "./turnstile-retry";

export type TurnstileScope = "signup" | "password-reset" | "anon-link" | "report";

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
      size: "flexible" | "compact";
      theme: "light" | "dark";
      language: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
      "before-interactive-callback": () => void;
      "after-interactive-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

/** Where a form shows the challenge, and whether one is waiting for a click.
 * Pass it to `TurnstileSlot` and to the form's submit button. */
export interface TurnstileChallenge {
  slotRef: RefObject<HTMLDivElement | null>;
  needsClick: boolean;
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

/** Turnstile's flexible size will not go narrower than this. */
const FLEXIBLE_MIN_WIDTH = 300;

/** Full width when the slot has room for it, else Cloudflare's compact size
 * (150px wide), so a narrow form on a phone never has a widget poking out of
 * it. The slot is `display: contents` until the challenge shows, so it is
 * measured through its parent's content box. */
function sizeFor(slot: HTMLElement | null): "flexible" | "compact" {
  const parent = slot?.parentElement;
  if (!parent) return "flexible";
  const style = getComputedStyle(parent);
  const width = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return width >= FLEXIBLE_MIN_WIDTH ? "flexible" : "compact";
}

/** What a guarded form's submit button says while a submission waits on
 * Cloudflare's click, in place of its spinner: one thing is left to do. */
export const CHALLENGE_LABEL = "Tick the box above";

/**
 * How a guarded form's submit button behaves. It stays pressable while a
 * challenge shows: a press queues the submission, which goes ahead by itself
 * once the box is ticked, so no press is lost. While a submission waits on
 * that click, the button stops spinning and says what is left to do.
 */
export function guardedButton(busy: boolean, challenge: TurnstileChallenge) {
  const waiting = busy && challenge.needsClick;
  return { waiting, spinning: busy && !waiting, disabled: busy };
}

/** A host for the widget when the form has no slot: the bottom-right corner,
 * which is far from the form, so every guarded form should have a slot. */
function cornerHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:60";
  document.body.appendChild(host);
  return host;
}

interface SolveOptions {
  siteKey: string;
  scope: TurnstileScope;
  /** The form's slot, or null to fall back to the corner. */
  slot: HTMLElement | null;
  /** Called with true when Cloudflare shows the challenge, false when done. */
  onInteractive: (waiting: boolean) => void;
}

/** Renders the widget and resolves with its token, or "" on an error or when
 * nothing answers in SOLVE_TIMEOUT_MS. The timer stops while a challenge is on
 * screen: a person reading it is not a failure. */
function renderForToken(turnstile: TurnstileApi, host: HTMLElement, opts: SolveOptions) {
  let widgetId: string | null = null;
  const token = new Promise<string>((resolve) => {
    let timer = setTimeout(() => resolve(""), SOLVE_TIMEOUT_MS);
    const done = (value: string) => {
      clearTimeout(timer);
      resolve(value);
    };
    widgetId = turnstile.render(host, {
      sitekey: opts.siteKey,
      action: opts.scope,
      appearance: "interaction-only",
      size: sizeFor(opts.slot),
      theme: currentTheme(),
      // The page's language, not the browser's: everything around the widget
      // is English, and a longer translation wraps inside its fixed height.
      language: document.documentElement.lang || "en",
      callback: done,
      "error-callback": () => done(""),
      "timeout-callback": () => done(""),
      "before-interactive-callback": () => {
        clearTimeout(timer);
        opts.onInteractive(true);
      },
      "after-interactive-callback": () => {
        opts.onInteractive(false);
        timer = setTimeout(() => resolve(""), SOLVE_TIMEOUT_MS);
      },
    });
  });
  return { token, widgetId: () => widgetId };
}

/** Resolves with a token, or "" if this browser could not produce one. "" is
 * deliberate rather than an exception: the server decides what an empty
 * token means. */
async function solve(opts: SolveOptions): Promise<string> {
  let corner: HTMLElement | null = null;
  let turnstile: TurnstileApi | null = null;
  let widgetId: () => string | null = () => null;
  try {
    turnstile = await loadScript();
    const host = opts.slot ?? (corner = cornerHost());
    const rendered = renderForToken(turnstile, host, opts);
    widgetId = rendered.widgetId;
    return await rendered.token;
  } catch {
    return "";
  } finally {
    opts.onInteractive(false);
    const id = widgetId();
    if (id) turnstile?.remove(id);
    corner?.remove();
  }
}

/**
 * The site key, waiting for /api/config if it has not answered yet. A form
 * submitted before then must not go out without a token. A failed fetch is
 * not cached, so the retry after a refusal asks again instead of failing for
 * the whole page load.
 */
async function siteKeyWhenReady(qc: QueryClient): Promise<string | undefined> {
  try {
    return (await qc.ensureQueryData(configQuery)).turnstileSiteKey;
  } catch {
    return undefined;
  }
}

type Pending = { token: Promise<string>; primedAt: number } | null;

/** Takes the primed token, if any. Single-use, so the slot is cleared: a form
 * submitted twice solves again rather than replaying a burned token. */
async function takeToken(pending: RefObject<Pending>): Promise<string> {
  const token = (await pending.current?.token) ?? "";
  pending.current = null;
  return token;
}

/** The one place that knows "we could not run the check" from "the server
 * refused it". */
function warnIfUnsolved(siteKey: string | undefined, token: string, scope: TurnstileScope) {
  if (siteKey && !token) console.warn("turnstile_solve_failed", scope);
}

/** The header a guarded request carries, or none without a token. */
function tokenHeader(token: string): Record<string, string> {
  return token ? { [TURNSTILE_TOKEN_HEADER]: token } : {};
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
  const qc = useQueryClient();
  const loadedSiteKey = useConfig().data?.turnstileSiteKey;
  const pending = useRef<Pending>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [needsClick, setNeedsClick] = useState(false);

  const startSolve = useCallback(
    (siteKey: string | undefined) => {
      if (!siteKey) return;
      const held = pending.current;
      if (held && Date.now() - held.primedAt < TOKEN_FRESH_MS) return;
      const slot = slotRef.current;
      const token = solve({ siteKey, scope, slot, onInteractive: setNeedsClick });
      pending.current = { token, primedAt: Date.now() };
    },
    [scope],
  );

  /** Starts early when the config is already here; headers() catches up
   * when it is not. */
  const prime = useCallback(() => startSolve(loadedSiteKey), [startSolve, loadedSiteKey]);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const siteKey = await siteKeyWhenReady(qc);
    startSolve(siteKey);
    const token = await takeToken(pending);
    warnIfUnsolved(siteKey, token, scope);
    return tokenHeader(token);
  }, [qc, startSolve, scope]);

  const guarded = useCallback<TurnstileGuard>(
    (run) => retryOnTurnstileFailure(run, headers),
    [headers],
  );

  const challenge = useMemo<TurnstileChallenge>(() => ({ slotRef, needsClick }), [needsClick]);

  return { prime, headers, guarded, challenge };
}
