import { Button } from "../ui/button";
import { BusyContent } from "../ui/spinner";

/**
 * The app could not ask who is signed in: a 5xx or a dropped connection on
 * `/user`. Not a sign-out, which only a 401 means (#487), so nobody is sent
 * to the login page for an outage. Full page, because without the account
 * there is no sidebar or org to draw.
 */
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
