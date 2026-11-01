import { RDYRCT_SITE } from "@/shared/site";
import { SUPPORT_EMAIL } from "@/shared/support";
import { cn } from "../ui/cn";

/**
 * Enterprise is handled by hand: several organizations and higher limits,
 * arranged by email, and a platform admin sets the allowance. There is no
 * checkout for it, so the only call to action is a mailto link. The address
 * is rdyrct's own, so a self-hosted build shows nothing.
 */
export function EnterpriseNote({ className }: { className?: string }) {
  if (!RDYRCT_SITE) return null;
  return (
    <p className={cn("text-sm text-muted", className)}>
      Need several organizations or higher limits?{" "}
      <a
        href={`mailto:${SUPPORT_EMAIL}?subject=Enterprise`}
        className="text-accent hover:underline"
      >
        Email us about Enterprise
      </a>
      .
    </p>
  );
}
