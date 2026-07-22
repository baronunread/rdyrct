import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { Button, IconButton } from "./button";
import { cn } from "./cn";

// Copy-to-clipboard button whose icon animates into a tick on success. The
// tick holds for a couple of seconds and repeat clicks while ticked don't
// replay the animation — the icon only flips back once the timeout elapses.
export function CopyButton({
  text,
  label,
  onCopy,
  display = "icon",
  children,
}: {
  text: string;
  label: string;
  onCopy: (text: string) => void | Promise<void>;
  display?: "icon" | "button";
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleClick = async () => {
    try {
      await onCopy(text);
      if (copied) return;
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // The caller reports clipboard errors in the app's usual toast.
    }
  };

  const icon = (
    <span className="relative block h-3 w-3">
      <Copy
        size={12}
        className={cn(
          "absolute inset-0 transition-all duration-200",
          copied ? "scale-50 opacity-0 blur-xs" : "scale-100 opacity-100",
        )}
      />
      <Check
        size={12}
        className={cn(
          "absolute inset-0 text-accent-2 transition-all duration-200",
          copied ? "scale-100 opacity-100" : "scale-50 opacity-0 blur-xs",
        )}
      />
    </span>
  );

  if (display === "button") {
    return (
      <Button variant="primary" onClick={handleClick}>
        {icon} {children}
      </Button>
    );
  }

  return (
    <IconButton label={label} onClick={handleClick}>
      {icon}
    </IconButton>
  );
}
