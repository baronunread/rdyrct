/**
 * index.html carries one JSON-LD block, written by hand, and it is the only
 * thing an answer engine reads to learn what this product costs. Two ways it
 * goes wrong silently:
 *
 * A syntax slip makes the whole block unparseable, and nothing in the app
 * notices: the browser ignores the tag, every page still renders, and the
 * loss shows up as an absence somewhere nobody looks. The same goes for a
 * dangling `@id` reference, which parses fine and describes a graph whose
 * halves no longer connect.
 *
 * And a node Google holds to stricter rules (an app with no ratings) fails
 * its rich-result check on every page at once.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as v from "valibot";

/**
 * A node keeps whatever else it declares (`looseObject`), because this suite
 * is about the shape the graph hangs together by, not an inventory of every
 * property schema.org allows on it.
 */
const Node = v.looseObject({
  "@type": v.string(),
  "@id": v.optional(v.string()),
});

const Document = v.object({
  "@context": v.literal("https://schema.org"),
  "@graph": v.array(Node),
});

/** What `publisher` and `isPartOf` hold: a pointer to another node, nothing else. */
const Reference = v.object({ "@id": v.string() });

/**
 * Parsed, not asserted: an unparseable block or a node missing its `@type`
 * fails here, before any test below reads a property off it.
 */
function graph() {
  const html = readFileSync("index.html", "utf8");
  const found = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
  expect(found.length, "index.html should carry exactly one JSON-LD block").toBe(1);

  const json = found[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
  return v.parse(Document, JSON.parse(json))["@graph"];
}

test("the block parses and every node declares a type", () => {
  expect(graph().length).toBeGreaterThan(0);
});

test("every @id a node points at is a node in the same graph", () => {
  const nodes = graph();
  const declared = new Set(nodes.map((node) => node["@id"]).filter(Boolean));

  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      const reference = v.safeParse(Reference, value);
      if (!reference.success) continue;
      expect(declared, `${node["@type"]}.${key} points at a node that is not here`).toContain(
        reference.output["@id"],
      );
    }
  }
});

test("no app or product node goes without the ratings Google requires of it", () => {
  // Google's rich-result check fails a SoftwareApplication (and its subtypes)
  // that has no aggregateRating or review, on every page this head ships on.
  // There are no ratings to cite honestly, so the node stays out until there are.
  const rated = ["SoftwareApplication", "WebApplication", "MobileApplication", "Product"];
  for (const node of graph().filter((n) => rated.includes(n["@type"]))) {
    expect(
      "aggregateRating" in node || "review" in node,
      `${node["@type"]} needs aggregateRating or review`,
    ).toBe(true);
  }
});

const FaqPage = v.object({
  "@context": v.literal("https://schema.org"),
  "@type": v.literal("FAQPage"),
  mainEntity: v.array(
    v.object({
      "@type": v.literal("Question"),
      name: v.string(),
      acceptedAnswer: v.object({ "@type": v.literal("Answer"), text: v.string() }),
    }),
  ),
});

/** Tags stripped, whitespace collapsed: what a reader of the fallback sees. */
function plain(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The crawler fallback in #root carries its FAQ as FAQPage too, and markup
 * that says something the page does not is worse than none. Every question
 * and answer in the block has to be an h3 and the paragraph under it.
 */
test("the fallback's FAQPage says what the fallback's FAQ says", () => {
  const html = readFileSync("index.html", "utf8");
  const block = html.match(/<script type="application\/ld\+json" id="faq">([\s\S]*?)<\/script>/);
  expect(block, "index.html should carry the fallback FAQ block").not.toBeNull();
  const { mainEntity } = v.parse(FaqPage, JSON.parse(block?.[1] ?? ""));

  const faq = html.slice(html.indexOf("<h2>Frequently asked questions</h2>"));
  const visible = [...faq.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map(
    ([, q, a]) => ({ q: plain(q), a: plain(a) }),
  );

  expect(
    mainEntity.map(({ name, acceptedAnswer }) => ({ q: name, a: acceptedAnswer.text })),
  ).toEqual(visible);
});
