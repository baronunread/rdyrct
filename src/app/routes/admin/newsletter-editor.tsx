/**
 * The newsletter's body: Resend's email editor (@react-email/editor), cut
 * down to what the email layout renders (worker/newsletter-doc.ts parses the
 * same list). Nothing else may be typed, pasted or picked from a menu: no
 * columns, tables, code, images, quotes, strike, alignment or inline styles.
 *
 * The package's own <EmailEditor> always mounts its full bubble and slash
 * menus, which would offer blocks this editor does not have, so this
 * composes the same parts with only the allowed items. Its stylesheet is
 * imported here, so only the admin page's chunk carries it.
 */
import "@react-email/editor/themes/default.css";
import "./newsletter-editor.css";
import { useEffect, useState, type RefObject } from "react";
import { EditorProvider, useCurrentEditor, type Editor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extension-placeholder";
import { StarterKit } from "@react-email/editor/extensions";
import {
  BULLET_LIST,
  BUTTON,
  BubbleMenu,
  DIVIDER,
  H2,
  H3,
  NUMBERED_LIST,
  SlashCommand,
  TEXT,
} from "@react-email/editor/ui";
import { cn } from "../../ui/cn";

/** http(s) only, the same rule the worker applies. A bare domain gets https. */
function httpUrl(value: string): string | null {
  const text = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

const OFF = false as const;

const extensions = [
  StarterKit.configure({
    Paragraph: { HTMLAttributes: { class: "node-paragraph" } },
    Heading: { levels: [2, 3] },
    BulletList: { HTMLAttributes: { class: "node-list node-bulletList" } },
    OrderedList: { HTMLAttributes: { class: "node-list node-orderedList" } },
    ListItem: { HTMLAttributes: { class: "node-listItem" } },
    Link: {
      openOnClick: false,
      autolink: false,
      defaultProtocol: "https",
      isAllowedUri: (url) => httpUrl(url) !== null,
      HTMLAttributes: { class: "node-link" },
    },
    MaxNesting: { maxDepth: 6, nodeTypes: ["bulletList", "orderedList"] },
    CodeBlockPrism: OFF,
    Code: OFF,
    TwoColumns: OFF,
    ThreeColumns: OFF,
    FourColumns: OFF,
    ColumnsColumn: OFF,
    TrailingNode: OFF,
    Blockquote: OFF,
    PreviewText: OFF,
    Strike: OFF,
    Sup: OFF,
    Uppercase: OFF,
    PreservedStyle: OFF,
    Table: OFF,
    TableRow: OFF,
    TableCell: OFF,
    TableHeader: OFF,
    Body: OFF,
    Container: OFF,
    Div: OFF,
    Section: OFF,
    GlobalContent: OFF,
    AlignmentAttribute: OFF,
    StyleAttribute: OFF,
    ClassAttribute: OFF,
  }),
  Placeholder.configure({
    placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write the email"),
    includeChildren: true,
  }),
];

const SLASH_ITEMS = [TEXT, H2, H3, BULLET_LIST, NUMBERED_LIST, BUTTON, DIVIDER];

/** The node selector's names for the blocks this editor does not have. */
const NOT_OFFERED = ["Title", "Quote", "Code"];

/** Selected text: block type, link, bold, italic, underline. */
function TextMenu() {
  // One popover at a time, as in the package's own menu.
  const [open, setOpen] = useState<"node" | "link" | null>(null);
  const toggle = (which: "node" | "link") => (next: boolean) =>
    setOpen((now) => (next ? which : now === which ? null : now));
  return (
    <BubbleMenu.Root
      hideWhenActiveNodes={["button", "horizontalRule"]}
      hideWhenActiveMarks={["link"]}
      onHide={() => setOpen(null)}
    >
      <BubbleMenu.NodeSelector
        omit={NOT_OFFERED}
        open={open === "node"}
        onOpenChange={toggle("node")}
      />
      <BubbleMenu.LinkSelector
        validateUrl={httpUrl}
        open={open === "link"}
        onOpenChange={toggle("link")}
      />
      <BubbleMenu.ItemGroup>
        <BubbleMenu.Bold />
        <BubbleMenu.Italic />
        <BubbleMenu.Underline />
      </BubbleMenu.ItemGroup>
    </BubbleMenu.Root>
  );
}

/** Hands the editor to the composer, and carries the field's ARIA. */
function Bridge({
  editorRef,
  labelId,
  reasonId,
  invalid,
}: {
  editorRef: RefObject<Editor | null>;
  labelId: string;
  reasonId: string;
  invalid: boolean;
}) {
  const { editor } = useCurrentEditor();
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    dom.setAttribute("aria-labelledby", labelId);
    dom.setAttribute("aria-multiline", "true");
    dom.setAttribute("role", "textbox");
    if (invalid) {
      dom.setAttribute("aria-invalid", "true");
      dom.setAttribute("aria-describedby", reasonId);
    } else {
      dom.removeAttribute("aria-invalid");
      dom.removeAttribute("aria-describedby");
    }
  }, [editor, labelId, reasonId, invalid]);
  return null;
}

export function NewsletterEditor({
  editorRef,
  labelId,
  reasonId,
  invalid,
  onChange,
}: {
  editorRef: RefObject<Editor | null>;
  labelId: string;
  reasonId: string;
  invalid: boolean;
  onChange: () => void;
}) {
  return (
    <div
      data-invalid={invalid || undefined}
      // The same rings as an Input (ui/field.tsx), keyed on data-invalid.
      className={cn(
        "newsletter-editor rounded-lg bg-surface smooth-shadow-ring-xs transition-[box-shadow] duration-150",
        "focus-within:shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_oklab,var(--accent)_25%,transparent)]",
        "data-invalid:shadow-[0_0_0_1.5px_var(--danger)] data-invalid:focus-within:shadow-[0_0_0_1.5px_var(--danger),0_0_0_4px_color-mix(in_oklab,var(--danger)_18%,transparent)]",
      )}
    >
      <EditorProvider
        extensions={extensions}
        immediatelyRender={false}
        onUpdate={onChange}
        editorProps={{ attributes: { class: "newsletter-editor-body", spellcheck: "true" } }}
      >
        <Bridge editorRef={editorRef} labelId={labelId} reasonId={reasonId} invalid={invalid} />
        <TextMenu />
        <BubbleMenu.LinkDefault validateUrl={httpUrl} />
        <BubbleMenu.ButtonDefault validateUrl={httpUrl} />
        <SlashCommand items={SLASH_ITEMS} />
      </EditorProvider>
    </div>
  );
}
