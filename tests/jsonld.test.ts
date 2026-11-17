/**
 * index.html carries one hand-written JSON-LD block. A syntax slip or a
 * dangling `@id` fails silently: the browser ignores the tag and every page
 * still renders. A node Google holds to stricter rules fails on every page.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as v from "valibot";

const Node = v.looseObject({
  "@type": v.string(),
  "@id": v.optional(v.string()),
});

const Document = v.object({
  "@context": v.literal("https://schema.org"),
  "@graph": v.array(Node),
});

const Reference = v.object({ "@id": v.string() });

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
  // Google's rich-result check fails a SoftwareApplication (and subtypes) with
  // no aggregateRating or review. There are no honest ratings to cite yet.
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

function plain(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Markup that says something the page does not is worse than none.
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
