/**
 * The composer's Preview: the issue as renderEmail draws it for the admin
 * (worker POST /admin/newsletter/preview), in a frame that runs no script.
 * Light and Dark switch the email's own prefers-color-scheme rule on or
 * off, so both are the email's real themes, whatever the browser's setting.
 */
import { useState } from "react";
import { Dialog } from "../../ui/dialog";
import { Segmented } from "../../ui/segmented";

type Theme = "light" | "dark";

const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

/** The email's dark rule (worker/email-layout.ts), forced on or off. */
const DARK_RULE = "@media (prefers-color-scheme: dark)";
const themed = (html: string, theme: Theme) =>
  html.replace(DARK_RULE, theme === "dark" ? "@media all" : "@media not all");

/** Before the frame has measured its page: about one short email. */
const FIRST_HEIGHT = 360;

export function PreviewDialog({
  html,
  subject,
  onClose,
}: {
  /** The rendered email, or null while closed. */
  html: string | null;
  subject: string;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState<Theme>("light");
  const [height, setHeight] = useState(FIRST_HEIGHT);
  return (
    <Dialog
      open={html !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Preview"
      size="wide"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">As you would get it, with your own unsubscribe link.</p>
          <Segmented items={THEMES} value={theme} onChange={setTheme} label="Theme" />
        </div>
        {html !== null && (
          <iframe
            // Same origin so the frame can be measured; no allow-scripts, so
            // nothing in it runs.
            sandbox="allow-same-origin"
            title={`Preview of ${subject}`}
            srcDoc={themed(html, theme)}
            onLoad={(event) => {
              // The body, not the root: the root is never shorter than the
              // frame, so it would keep the first guess as a gap.
              const page = event.currentTarget.contentDocument?.body;
              if (page) setHeight(page.scrollHeight);
            }}
            style={{ colorScheme: theme, height }}
            className="w-full rounded-lg bg-bg smooth-shadow-ring-xs"
          />
        )}
      </div>
    </Dialog>
  );
}
