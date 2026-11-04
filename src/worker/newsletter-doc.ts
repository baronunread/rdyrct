/**
 * The newsletter body as the admin editor sends it: a TipTap JSON document
 * (@react-email/editor), never HTML. This parses it against an allow-list of
 * the nodes and marks the email layout renders and turns it into the
 * layout's own `EmailBlock`s. Anything else is a 400 that names it.
 *
 * The editor in src/app/routes/admin/newsletter-editor.tsx is cut down to the
 * same list, so a refusal here means a client that is not that editor.
 */
import * as v from "valibot";
import type { EmailBlock, EmailInline } from "./email-layout";
import { safeUrl } from "./email-html";

type DocMark =
  | { type: "bold" | "italic" | "underline" }
  | { type: "link"; attrs: { href: string } };
type DocInline = { type: "text"; text: string; marks?: DocMark[] } | { type: "hardBreak" };
type DocListItem = { type: "listItem"; content: DocBlock[] };
type DocBlock =
  | { type: "paragraph"; content?: DocInline[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: DocInline[] }
  | { type: "horizontalRule" }
  | { type: "button"; attrs: { href: string }; content?: DocInline[] }
  | { type: "bulletList"; content: DocListItem[] }
  | { type: "orderedList"; attrs?: { start?: number | null }; content: DocListItem[] };
export type NewsletterDoc = { type: "doc"; content: DocBlock[] };

/** Lists inside lists, at most this deep. */
const MAX_LIST_DEPTH = 4;
/** Every node in the document, text runs included. */
const MAX_NODES = 5_000;
/** All the text, as in the old plain body. */
const MAX_TEXT = 20_000;

/** The message for a type outside the allow-list: names it, so the 400 says
 * what to take out. `received` is the type, already quoted. */
const notAllowed = (what: string) => (issue: v.BaseIssue<unknown>) =>
  `A newsletter cannot hold a ${issue.received} ${what}`;

const markSchema = v.variant(
  "type",
  [
    v.object({ type: v.picklist(["bold", "italic", "underline"]) }),
    v.object({
      type: v.literal("link"),
      attrs: v.object({ href: v.pipe(v.string("A link needs an address"), v.maxLength(2_000)) }),
    }),
  ],
  notAllowed("mark"),
);

const inlineSchema = v.variant(
  "type",
  [
    v.object({
      type: v.literal("text"),
      text: v.pipe(v.string(), v.maxLength(MAX_TEXT)),
      marks: v.optional(v.pipe(v.array(markSchema), v.maxLength(8))),
    }),
    v.object({ type: v.literal("hardBreak") }),
  ],
  notAllowed("inline node"),
);

const inlineContent = v.optional(v.array(inlineSchema));

// Annotated because a list holds blocks and a block may be a list, which
// TypeScript cannot infer through v.lazy. The schema is that same union.
const blockSchema: v.GenericSchema<DocBlock> = v.lazy(() =>
  v.variant(
    "type",
    [
      v.object({ type: v.literal("paragraph"), content: inlineContent }),
      v.object({
        type: v.literal("heading"),
        attrs: v.object({ level: v.picklist([2, 3], "Headings are large or small only") }),
        content: inlineContent,
      }),
      v.object({ type: v.literal("horizontalRule") }),
      v.object({
        type: v.literal("button"),
        attrs: v.object({ href: v.pipe(v.string("A button needs a link"), v.maxLength(2_000)) }),
        content: inlineContent,
      }),
      v.object({ type: v.literal("bulletList"), content: v.array(listItemSchema) }),
      v.object({
        type: v.literal("orderedList"),
        attrs: v.optional(
          v.object({
            start: v.optional(
              v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000))),
            ),
          }),
        ),
        content: v.array(listItemSchema),
      }),
    ],
    notAllowed("block"),
  ),
);

const listItemSchema = v.object({
  type: v.literal("listItem", "A list holds list items only"),
  content: v.pipe(v.array(blockSchema), v.minLength(1, "A list item is empty")),
});

/** Every text run, in reading order. */
function inlineRuns(blocks: DocBlock[]): DocInline[] {
  return blocks.flatMap((block): DocInline[] => {
    if (block.type === "bulletList" || block.type === "orderedList") {
      return block.content.flatMap((item) => inlineRuns(item.content));
    }
    return "content" in block ? (block.content ?? []) : [];
  });
}

const docText = (doc: NewsletterDoc) =>
  inlineRuns(doc.content)
    .map((run) => (run.type === "text" ? run.text : ""))
    .join("");

/** How deep a document's lists go, and how many nodes it has in all. */
interface DocSize {
  depth: number;
  nodes: number;
}

function measure(blocks: DocBlock[], depth = 0): DocSize {
  let deepest = depth;
  let nodes = 0;
  for (const block of blocks) {
    nodes += 1;
    if (block.type === "bulletList" || block.type === "orderedList") {
      for (const item of block.content) {
        const inner = measure(item.content, depth + 1);
        deepest = Math.max(deepest, inner.depth);
        nodes += 1 + inner.nodes;
      }
    } else if ("content" in block) {
      nodes += block.content?.length ?? 0;
    }
  }
  return { depth: deepest, nodes };
}

const buttonLabel = (content: DocInline[] | undefined) =>
  (content ?? [])
    .map((run) => (run.type === "text" ? run.text : " "))
    .join("")
    .trim();

/** Each button, for the check that it has a label and an http(s) link. */
function buttons(blocks: DocBlock[]): Extract<DocBlock, { type: "button" }>[] {
  return blocks.flatMap((block) => {
    if (block.type === "button") return [block];
    if (block.type === "bulletList" || block.type === "orderedList") {
      return block.content.flatMap((item) => buttons(item.content));
    }
    return [];
  });
}

export const newsletterDocSchema = v.pipe(
  v.object(
    {
      type: v.literal("doc", "The email is not an editor document"),
      content: v.array(blockSchema),
    },
    "The email is not an editor document",
  ),
  v.check((doc) => docText(doc).trim().length > 0, "Write the email"),
  v.check((doc) => docText(doc).length <= MAX_TEXT, "The email is too long"),
  v.check((doc) => measure(doc.content).nodes <= MAX_NODES, "The email is too long"),
  v.check(
    (doc) => measure(doc.content).depth <= MAX_LIST_DEPTH,
    `Lists nest ${MAX_LIST_DEPTH} deep at most`,
  ),
  v.check(
    (doc) =>
      buttons(doc.content).every((b) => buttonLabel(b.content) && safeUrl(b.attrs.href) !== "#"),
    "A button needs a label and an http(s) link",
  ),
);

function toInline(run: DocInline): EmailInline {
  if (run.type === "hardBreak") return { lineBreak: true };
  const marks = run.marks ?? [];
  const has = (type: DocMark["type"]) => marks.some((mark) => mark.type === type);
  const link = marks.find((mark) => mark.type === "link");
  return {
    text: run.text,
    ...(has("bold") && { bold: true }),
    ...(has("italic") && { italic: true }),
    ...(has("underline") && { underline: true }),
    ...(link && "attrs" in link && { href: link.attrs.href }),
  };
}

/** A paragraph or heading with no text: the blank lines between blocks,
 * which the layout's own margins already provide. */
const blank = (content: DocInline[] | undefined) =>
  !content?.some((run) => run.type === "text" && run.text.trim());

/** A paragraph's or heading's runs, or nothing for a blank one. */
const runsOf = (content: DocInline[] | undefined): EmailInline[] | null =>
  content && !blank(content) ? content.map(toInline) : null;

type DocList = Extract<DocBlock, { type: "bulletList" | "orderedList" }>;

function toList(block: DocList): EmailBlock {
  const items = block.content.map((item) => item.content.flatMap(toBlock));
  if (block.type === "bulletList") return { kind: "list", ordered: false, items };
  const start = block.attrs?.start || 1;
  return { kind: "list", ordered: true, ...(start !== 1 && { start }), items };
}

function toBlock(block: DocBlock): EmailBlock[] {
  switch (block.type) {
    case "paragraph": {
      const content = runsOf(block.content);
      return content ? [{ kind: "paragraph", content }] : [];
    }
    case "heading": {
      const content = runsOf(block.content);
      return content ? [{ kind: "heading", level: block.attrs.level, content }] : [];
    }
    case "horizontalRule":
      return [{ kind: "divider" }];
    case "button":
      return [{ kind: "button", label: buttonLabel(block.content), url: block.attrs.href }];
    case "bulletList":
    case "orderedList":
      return [toList(block)];
  }
}

/** The parsed document as the layout's blocks. */
export function docToBlocks(doc: NewsletterDoc): EmailBlock[] {
  return doc.content.flatMap(toBlock);
}
