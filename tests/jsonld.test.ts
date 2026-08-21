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
 * And the offer mirrors PLAN_PRICES in src/shared/types.ts, so raising a
 * price leaves a stale number quoted here, in the one place built to be
 * quoted back.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as v from "valibot";
import { PLAN_PRICES } from "../src/shared/types";

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

const SoftwareApplication = v.looseObject({
  offers: v.looseObject({
    lowPrice: v.string(),
    highPrice: v.string(),
    priceCurrency: v.string(),
  }),
});

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

test("the quoted price is the price this app charges", () => {
  const app = graph().find((node) => node["@type"] === "SoftwareApplication");
  expect(app, "the graph should describe the app itself").toBeDefined();

  const { offers } = v.parse(SoftwareApplication, app);
  // PLAN_PRICES carries the currency symbol for display; schema.org wants the
  // bare number beside priceCurrency.
  expect(offers.highPrice).toBe(PLAN_PRICES.pro.replace("$", ""));
  expect(offers.lowPrice, "the free plan is the bottom of the range").toBe("0");
  expect(offers.priceCurrency).toBe("USD");
});
