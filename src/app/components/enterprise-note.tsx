import { RDYRCT_SITE } from "@/shared/site";
import { SUPPORT_EMAIL } from "@/shared/support";
import { cn } from "../ui/cn";

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
