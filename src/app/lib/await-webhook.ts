import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const WEBHOOK_POLL_MS = 2000;
const WEBHOOK_POLL_TRIES = 5;

/**
 * Waits for a Polar webhook to land, by asking the server again.
 *
 * Polar sends the browser back before it delivers the webhook, so both
 * returns (from checkout and from the subscription portal) read the row as it
 * was. One refetch races the delivery, so keep asking while `waiting` until
 * `arrived`, then give up rather than poll forever.
 *
 * The callbacks live in a ref: they close over state setters that change
 * every render, and re-running the interval on each of those would reset the
 * try count and make "give up" unreachable.
 */
export function useAwaitWebhook({
  waiting,
  arrived,
  onArrived,
  onGaveUp,
}: {
  waiting: boolean;
  arrived: boolean;
  onArrived: () => void;
  onGaveUp: () => void;
}) {
  const qc = useQueryClient();
  const callbacks = useRef({ onArrived, onGaveUp });
  useEffect(() => {
    callbacks.current = { onArrived, onGaveUp };
  });

  useEffect(() => {
    if (!waiting) return;
    if (arrived) {
      callbacks.current.onArrived();
      return;
    }
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      if (tries > WEBHOOK_POLL_TRIES) {
        window.clearInterval(id);
        callbacks.current.onGaveUp();
        return;
      }
      void qc.refetchQueries({ queryKey: ["user"] });
    }, WEBHOOK_POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting, arrived, qc]);
}
