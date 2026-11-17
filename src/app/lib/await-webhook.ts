import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const WEBHOOK_POLL_MS = 2000;
const WEBHOOK_POLL_TRIES = 5;

// Polar sends the browser back before it delivers the webhook, so one refetch races the
// delivery. Callbacks live in a ref: re-running the interval each render would reset the try count.
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
