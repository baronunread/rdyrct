import { cn } from "../ui/cn";

/** A short link as "host/slug" in mono, the host quiet and the slug in ink.
 * When space runs out the host gives way first: the slug is the part that
 * tells two links apart, so it is the last thing to truncate. */
export function ShortAddress({
  url,
  slug,
  className,
}: {
  url: string;
  slug: string;
  className?: string;
}) {
  return (
    <span title={url} className={cn("flex min-w-0 max-w-full font-mono text-xs", className)}>
      <span className="min-w-0 shrink-[999] truncate text-muted">{new URL(url).host}</span>
      <span className="min-w-0 truncate">/{slug}</span>
    </span>
  );
}
