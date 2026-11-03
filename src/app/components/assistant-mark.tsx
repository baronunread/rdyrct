/**
 * An AI assistant's own mark, for the MCP tab's tiles and its Connected
 * list. The marks come from lobe-icons (@lobehub/icons-static-svg, MIT) and
 * VS Code's from Tabler (MIT), never drawn by hand. Each SVG is its own
 * file under /assets (`no-inline`), fetched only on this tab; the strict CSP
 * allows same-origin images.
 *
 * Claude's and Claude Code's marks carry their own colour, so they are
 * plain images. OpenAI's, Cursor's and MCP's are one-colour marks drawn in
 * `currentColor`: they paint as a mask over the text colour, so they read
 * in light and dark alike.
 */
import type { CSSProperties } from "react";
import { IconBrandVscode } from "@tabler/icons-react";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg?no-inline";
import claudeCode from "@lobehub/icons-static-svg/icons/claudecode-color.svg?no-inline";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?no-inline";
import cursor from "@lobehub/icons-static-svg/icons/cursor.svg?no-inline";
import mcp from "@lobehub/icons-static-svg/icons/mcp.svg?no-inline";
import { cn } from "../ui/cn";

export type AssistantMarkId = "claude" | "chatgpt" | "cursor" | "vscode" | "claude-code" | "other";

const COLOUR = { claude, "claude-code": claudeCode } as const;
const ONE_COLOUR = { chatgpt: openai, cursor, other: mcp } as const;

/** A one-colour SVG painted in the text colour. */
function maskStyle(src: string): CSSProperties {
  const url = `url("${src}")`;
  return {
    maskImage: url,
    WebkitMaskImage: url,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
  };
}

export function AssistantMark({ id, className }: { id: AssistantMarkId; className?: string }) {
  if (id === "vscode")
    return (
      <IconBrandVscode aria-hidden className={cn("text-[#2f8de4]", className)} stroke={1.75} />
    );
  if (id === "claude" || id === "claude-code")
    return <img src={COLOUR[id]} alt="" aria-hidden className={className} draggable={false} />;
  return (
    <span aria-hidden className={cn("bg-current", className)} style={maskStyle(ONE_COLOUR[id])} />
  );
}

/** Which mark an OAuth client's own name stands for, if any: the Connected
 * list shows what the client called itself at sign-in. */
export function markForClient(name: string): AssistantMarkId | null {
  const n = name.toLowerCase();
  return CLIENT_NAMES.find(([, words]) => words.some((w) => n.includes(w)))?.[0] ?? null;
}

/** In order: "Claude Code" has to match before "Claude" does. */
const CLIENT_NAMES = [
  ["claude-code", ["claude code"]],
  ["claude", ["claude"]],
  ["chatgpt", ["chatgpt", "openai"]],
  ["cursor", ["cursor"]],
  ["vscode", ["vs code", "vscode", "visual studio code"]],
] as const satisfies readonly (readonly [AssistantMarkId, readonly string[]])[];
