import { displayHost } from "../lib/display-url";
import { cn } from "../ui/cn";

/**
 * A short link as "host/slug" in mono, the host quiet and the slug in ink.
 *
 * When space runs out the host gives way first, with an ellipsis: the slug
 * is the part that tells two links apart. The slug never shrinks below its
 * own width (`shrink-0`) except when it alone is wider than the space, which
 * `max-w-full` catches, and only then is its end cut. Shrink weights would
 * not do this: they take a fraction of a pixel from the slug as well, and
 * that is enough to give it an ellipsis while the host still shows.
 *
 * `hideHost` drops the host for an address that sits under its link and
 * shares its host, so it would only repeat it.
 */
export function ShortAddress({
  url,
  slug,
  hideHost = false,
  className,
  slugClassName,
}: {
  url: string;
  slug: string;
  hideHost?: boolean;
  className?: string;
  slugClassName?: string;
}) {
  const host = displayHost(new URL(url).host);
  return (
    <span
      title={`${host}/${slug}`}
      className={cn("flex max-w-full min-w-0 font-mono text-xs", className)}
    >
      {!hideHost && <span className="min-w-0 truncate text-muted">{host}</span>}
      <span className={cn("max-w-full shrink-0 truncate", slugClassName)}>/{slug}</span>
    </span>
  );
}
