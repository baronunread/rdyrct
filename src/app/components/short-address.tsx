import { displayHost } from "../lib/display-url";
import { cn } from "../ui/cn";
import { OverflowTip } from "@/app/ui/overflow-tip";

/** Shrink weights would not keep the slug whole: they take a fraction of a pixel
 * from it too, enough to ellipsize it while the host still shows. */
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
    <OverflowTip content={`${host}/${slug}`}>
      <span className={cn("flex max-w-full min-w-0 font-mono text-xs", className)}>
        {!hideHost && <span className="min-w-0 truncate text-muted">{host}</span>}
        <span className={cn("max-w-full shrink-0 truncate", slugClassName)}>/{slug}</span>
      </span>
    </OverflowTip>
  );
}
