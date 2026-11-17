import { Button } from "../ui/button";
import { BusyContent } from "../ui/spinner";

/** A 5xx or dropped connection on `/user` is not a sign-out; only a 401 is (#487). */
export function Unreachable({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div role="alert" className="flex max-w-[440px] flex-col items-center gap-3">
        <h1 className="text-[22px] font-semibold text-balance">Could not reach rdyrct</h1>
        <p className="text-pretty text-muted">
          Your links and data are fine. Try again in a moment, or check your connection.
        </p>
        <Button
          variant="primary"
          className="mt-1.5"
          onClick={onRetry}
          aria-busy={retrying || undefined}
        >
          <BusyContent busy={retrying}>Retry</BusyContent>
        </Button>
      </div>
    </main>
  );
}
