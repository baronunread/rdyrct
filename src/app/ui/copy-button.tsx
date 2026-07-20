import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { IconButton } from "./button";
import { cn } from "./cn";

// Copy-to-clipboard button whose icon animates into a tick on success. The
// tick holds for a couple of seconds and repeat clicks while ticked don't
// replay the animation — the icon only flips back once the timeout elapses.
export function CopyButton({
  text,
  label,
  onCopy,
}: {
  text: string;
  label: string;
  onCopy: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleClick = () => {
    onCopy(text);
    if (copied) return;
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <IconButton label={label} onClick={handleClick}>
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
    </IconButton>
  );
}
