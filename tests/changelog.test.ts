import { describe, expect, test } from "bun:test";
import { inlinePieces, parseChangelog } from "../src/app/lib/changelog";

const SAMPLE = `# Changelog

## 1.1.0

A short intro that
wraps.

### Fixes

- **Bold start.** Then text with \`CODE\` in it,
  wrapped onto a second line.
- Plain bullet.

## 1.0.0

- A bullet with no section.
`;

describe("parseChangelog", () => {
  const releases = parseChangelog(SAMPLE);

  test("splits releases, newest first as written", () => {
    expect(releases.map((r) => r.version)).toEqual(["1.1.0", "1.0.0"]);
  });

  test("joins a wrapped intro paragraph", () => {
    expect(releases[0]?.intro).toEqual(["A short intro that wraps."]);
  });

  test("joins a wrapped bullet and keeps the sections apart", () => {
    expect(releases[0]?.sections[0]).toEqual({
      title: "Fixes",
      items: [
        "**Bold start.** Then text with `CODE` in it, wrapped onto a second line.",
        "Plain bullet.",
      ],
    });
  });

  test("a bullet before any heading lands in an untitled section", () => {
    expect(releases[1]?.sections).toEqual([{ title: "", items: ["A bullet with no section."] }]);
  });

  test("reads the real file", async () => {
    const real = parseChangelog(await Bun.file("CHANGELOG.md").text());
    expect(real[0]?.version).toBe("1.0.0");
    expect(real[0]?.sections.length).toBeGreaterThan(0);
  });
});

describe("inlinePieces", () => {
  test("separates bold and code from text", () => {
    expect(inlinePieces("a **b** and `c`")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " and " },
      { kind: "code", text: "c" },
    ]);
  });
});
