import { cn } from "./cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function BusyContent({
  busy,
  icon,
  children,
}: {
  busy: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span className="busy-label" data-busy={busy ? "" : undefined}>
        {children}
      </span>
      <span
        className="busy-spinner absolute inset-0 flex items-center justify-center pointer-events-none"
        data-busy={busy ? "" : undefined}
        aria-hidden
      >
        {icon ?? <Spinner />}
      </span>
    </span>
  );
}
