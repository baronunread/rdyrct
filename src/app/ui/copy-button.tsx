import { useEffect, useRef, useState, type ReactNode } from "react";
import { MorphIcon } from "morphicons/react";
import { check, copy } from "./icon-nodes";
import { Button, IconButton } from "./button";

// Copy-to-clipboard button whose icon morphs into a tick on success. The
// tick holds for two seconds after the last click: a click while ticked
// copies again and restarts the hold, but never replays the morph, and the
// icon flips back once, when the clicks stop.
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
      // One timer, restarted by every click: several clicks used to queue
      // a timer each, and the first to fire flipped the icon back while the
      // next click was flipping it to the tick again.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
      setCopied(true);
    } catch {
      // The caller reports clipboard errors in the app's usual toast.
    }
  };

  const icon = (
    <MorphIcon
      icon={copied ? check : copy}
      size={12}
      spring="snappy"
      className={copied ? "text-accent-2" : undefined}
    />
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
