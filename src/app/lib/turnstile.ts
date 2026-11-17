// The widget renders `interaction-only`: invisible unless Cloudflare wants a click.
// A failure here never blocks the form: the server decides what an empty token means
// (rejected when TURNSTILE_SECRET_KEY is set, ignored when not) (#304).
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { TURNSTILE_TOKEN_HEADER } from "@/shared/types";
import { configQuery, useConfig } from "./hooks";
import { currentTheme } from "./theme";
import { retryOnTurnstileFailure } from "./turnstile-retry";

export type TurnstileScope = "signup" | "password-reset" | "anon-link" | "report";

export type TurnstileGuard = <T>(
  run: (headers: Record<string, string>) => Promise<T>,
) => Promise<T>;

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const SOLVE_TIMEOUT_MS = 20_000;

// Tokens expire after 300s at Cloudflare; discard ours well before.
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

// A failed load is not remembered, so one dropped connection does not poison the tab.
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

// Turnstile's flexible size will not go narrower than this.
const FLEXIBLE_MIN_WIDTH = 300;

// The slot is `display: contents` until the challenge shows, so it is
// measured through its parent's content box.
function sizeFor(slot: HTMLElement | null): "flexible" | "compact" {
  const parent = slot?.parentElement;
  if (!parent) return "flexible";
  const style = getComputedStyle(parent);
  const width = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return width >= FLEXIBLE_MIN_WIDTH ? "flexible" : "compact";
}

export const CHALLENGE_LABEL = "Tick the box above";

// It stays pressable while a challenge shows: a press queues the submission, which goes
// ahead once the box is ticked, so no press is lost.
export function guardedButton(busy: boolean, challenge: TurnstileChallenge) {
  const waiting = busy && challenge.needsClick;
  return { waiting, spinning: busy && !waiting, disabled: busy };
}

// The bottom-right corner is far from the form, so every guarded form should have a slot.
function cornerHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:60";
  document.body.appendChild(host);
  return host;
}

interface SolveOptions {
  siteKey: string;
  scope: TurnstileScope;
  slot: HTMLElement | null;
  onInteractive: (waiting: boolean) => void;
}

// The timer stops while a challenge is on screen: a person reading it is not a failure.
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

// "" is deliberate rather than an exception: the server decides what an empty token means.
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

// A form submitted before the key arrives must not go out without a token. A failed
// fetch is not cached, so the retry after a refusal asks again.
async function siteKeyWhenReady(qc: QueryClient): Promise<string | undefined> {
  try {
    return (await qc.ensureQueryData(configQuery)).turnstileSiteKey;
  } catch {
    return undefined;
  }
}

type Pending = { token: Promise<string>; primedAt: number } | null;

// Single-use, so the slot is cleared: a form submitted twice solves again
// rather than replaying a burned token.
async function takeToken(pending: RefObject<Pending>): Promise<string> {
  const token = (await pending.current?.token) ?? "";
  pending.current = null;
  return token;
}

// The one place that knows "we could not run the check" from "the server refused it".
function warnIfUnsolved(siteKey: string | undefined, token: string, scope: TurnstileScope) {
  if (siteKey && !token) console.warn("turnstile_solve_failed", scope);
}

function tokenHeader(token: string): Record<string, string> {
  return token ? { [TURNSTILE_TOKEN_HEADER]: token } : {};
}

// `prime()` is safe to call on every keystroke and starts the work once.
// `headers()` awaits whatever that produced, so a fast typist waits and everyone else does not.
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
