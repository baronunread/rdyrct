/**
 * CHANGELOG.md, parsed for the /changelog page.
 *
 * The file stays the one source: a self-hoster reads it on GitHub, the page
 * reads the same text at build time, and nobody keeps a second copy in step.
 * Only the shapes that file uses are understood: `## version`, `### section`,
 * `- bullet` (wrapped lines indented under it) and plain paragraphs.
 */
export interface Release {
  version: string;
  intro: string[];
  sections: { title: string; items: string[] }[];
}

type LineKind = "release" | "section" | "bullet" | "indented" | "blank" | "title" | "text";

function classify(line: string): { kind: LineKind; text: string } {
  if (line.startsWith("## ")) return { kind: "release", text: line.slice(3).trim() };
  if (line.startsWith("### ")) return { kind: "section", text: line.slice(4).trim() };
  if (line.startsWith("# ")) return { kind: "title", text: "" };
  if (line.startsWith("- ")) return { kind: "bullet", text: line.slice(2).trim() };
  if (line.trim() === "") return { kind: "blank", text: "" };
  return { kind: line.startsWith("  ") ? "indented" : "text", text: line.trim() };
}

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | undefined;
  let section: Release["sections"][number] | undefined;
  let paragraph = "";

  const endParagraph = () => {
    if (paragraph) release?.intro.push(paragraph);
    paragraph = "";
  };
  const startSection = (title: string) => {
    section = { title, items: [] };
    release?.sections.push(section);
  };
  const addText = (text: string, indented: boolean) => {
    const last = section?.items.length ? section.items.length - 1 : -1;
    if (indented && section && last >= 0) section.items[last] += ` ${text}`;
    else if (!section) paragraph = paragraph ? `${paragraph} ${text}` : text;
  };

  for (const { kind, text } of lines(markdown)) {
    if (kind === "release") {
      endParagraph();
      release = { version: text, intro: [], sections: [] };
      section = undefined;
      releases.push(release);
    } else if (!release || kind === "title") continue;
    else if (kind === "section") {
      endParagraph();
      startSection(text);
    } else if (kind === "bullet") {
      if (!section) startSection("");
      section?.items.push(text);
    } else if (kind === "blank") endParagraph();
    else addText(text, kind === "indented");
  }
  endParagraph();
  return releases;
}

function* lines(markdown: string) {
  for (const line of markdown.split("\n")) yield classify(line);
}

/** One line of the file's inline markup, as pieces a component can render. */
export function inlinePieces(text: string): { kind: "text" | "bold" | "code"; text: string }[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter(Boolean)
    .map((piece) =>
      piece.startsWith("**")
        ? { kind: "bold" as const, text: piece.slice(2, -2) }
        : piece.startsWith("`")
          ? { kind: "code" as const, text: piece.slice(1, -1) }
          : { kind: "text" as const, text: piece },
    );
}
