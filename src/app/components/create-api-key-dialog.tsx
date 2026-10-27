import { useRef, useState, type FormEvent } from "react";
import type { ApiKeyDTO } from "@/shared/types";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { McpSetupCopyButton } from "./mcp-setup-prompt";

/** The key value, shown once right after minting, with its copy buttons. */
function NewKeyShownOnce({ apiKey, onDone }: { apiKey: ApiKeyDTO; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-pretty">
        <strong>{apiKey.name}</strong> is ready. Copy the key now: it won't be shown again.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">
          {apiKey.key}
        </code>
        <CopyButton
          text={apiKey.key ?? ""}
          label="Copy key"
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <McpSetupCopyButton apiKey={apiKey.key} />
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function NameForm({ onCreate, creating }: { onCreate: (name: string) => void; creating: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Required");
      input.current?.focus();
      return;
    }
    onCreate(trimmed);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Name" error={error}>
        <Input
          ref={input}
          autoFocus
          autoComplete="off"
          maxLength={100}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
          placeholder="Key name, e.g. Claude"
        />
      </Field>
      <p className="text-xs text-pretty text-muted">
        You see the full key once, when you create it.
      </p>
      <div className="flex justify-end pt-1">
        <Button type="submit" variant="primary">
          <BusyContent busy={creating}>Create key</BusyContent>
        </Button>
      </div>
    </form>
  );
}

/** "New key": name it, then the minted key is shown once, in the same dialog,
 * until Done or close. Server failures are toasts in the caller: no field owns
 * them. */
export function CreateApiKeyDialog({
  open,
  onOpenChange,
  justCreated,
  onCreate,
  creating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  justCreated: ApiKeyDTO | null;
  onCreate: (name: string) => void;
  creating: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={justCreated ? "Copy your key" : "New API key"}
    >
      {justCreated ? (
        <NewKeyShownOnce apiKey={justCreated} onDone={() => onOpenChange(false)} />
      ) : (
        <NameForm onCreate={onCreate} creating={creating} />
      )}
    </Dialog>
  );
}
