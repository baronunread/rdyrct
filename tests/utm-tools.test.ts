import { describe, expect, test } from "bun:test";
import { EMPTY_UTM } from "../src/shared/utm";
import {
  MAX_BULK_LINKS,
  PRESETS,
  bulkCsv,
  bulkLinks,
  channelOptions,
  linkChannels,
  typedChannelNote,
} from "../src/app/lib/utm-tools";
import { templateName } from "../src/app/lib/utm-templates";

const linkedin = PRESETS[2];
const newsletter = PRESETS[0];
const campaign = { ...EMPTY_UTM, utmCampaign: "spring-sale" };

describe("bulkLinks", () => {
  test("one link per address and channel", () => {
    const { links } = bulkLinks("example.com/a\nexample.com/b", [linkedin, newsletter], campaign);
    expect(links.map((l) => l.tagged)).toEqual([
      "https://example.com/a?utm_source=linkedin&utm_medium=social&utm_campaign=spring-sale",
      "https://example.com/a?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale",
      "https://example.com/b?utm_source=linkedin&utm_medium=social&utm_campaign=spring-sale",
      "https://example.com/b?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale",
    ]);
  });

  test("with no channel picked, every link uses the typed source and medium", () => {
    const fields = { ...campaign, utmSource: "partner", utmMedium: "referral" };
    const { links } = bulkLinks("example.com/a\nexample.com/b", [], fields);
    expect(links.map((l) => l.fields.utmSource)).toEqual(["partner", "partner"]);
  });

  test("a typed source is one more channel beside the picked ones", () => {
    const fields = { ...campaign, utmSource: "partner", utmMedium: "referral" };
    const { links } = bulkLinks("example.com", [linkedin], fields);
    expect(links.map((l) => l.fields.utmSource)).toEqual(["linkedin", "partner"]);
  });

  test("skips blank lines and repeats, and names the lines that are not addresses", () => {
    const text =
      "example.com/a\n\nnot an address\nhttps://example.com/a\nexample.com/a?utm_source=x";
    const result = bulkLinks(text, [], campaign);
    expect(result.links).toHaveLength(1);
    expect(result.badLines).toEqual([3]);
  });

  test("stops at the cap and says so", () => {
    const text = Array.from({ length: MAX_BULK_LINKS }, (_, i) => `example.com/${i}`).join("\n");
    const result = bulkLinks(text, [linkedin, newsletter], campaign);
    expect(result.links).toHaveLength(MAX_BULK_LINKS);
    expect(result.capped).toBe(true);
  });
});

test("names the lines whose own tags the fields replace", () => {
  const text = "example.com/a\nexample.com/b?utm_campaign=keep&ref=x";
  const result = bulkLinks(text, [], { ...campaign, utmSource: "x" });
  expect(result.taggedLines).toEqual([2]);
  expect(result.links[1]?.tagged).toBe(
    "https://example.com/b?ref=x&utm_source=x&utm_campaign=spring-sale",
  );
});

describe("typedChannelNote", () => {
  test("nothing to say with no channel picked", () => {
    expect(typedChannelNote([], { ...EMPTY_UTM, utmSource: "x" })).toBeNull();
  });

  test("a typed source is one more channel", () => {
    expect(typedChannelNote([linkedin], { ...EMPTY_UTM, utmSource: "x", utmMedium: "y" })).toBe(
      "Also one link each for x / y, from the fields below.",
    );
  });

  test("a medium with no source is said to be unused", () => {
    expect(typedChannelNote([linkedin], { ...EMPTY_UTM, utmMedium: "email" })).toContain(
      "not used",
    );
  });
});

test("templateName keeps each value in its place", () => {
  expect(templateName({ ...EMPTY_UTM, utmSource: "a", utmMedium: "b" })).toBe("a / b");
  expect(templateName({ ...EMPTY_UTM, utmSource: "a", utmCampaign: "b" })).toBe("a / – / b");
});

describe("channels", () => {
  test("the typed pair is dropped when it repeats a picked channel", () => {
    const fields = { ...EMPTY_UTM, utmSource: "linkedin", utmMedium: "social" };
    expect(linkChannels([linkedin], fields)).toHaveLength(1);
  });

  test("templates with a source become channels, once each", () => {
    const options = channelOptions([
      { ...EMPTY_UTM, utmSource: "linkedin", utmMedium: "social" },
      { ...EMPTY_UTM, utmSource: "partner", utmMedium: "referral", utmCampaign: "a" },
      { ...EMPTY_UTM, utmSource: "partner", utmMedium: "referral", utmCampaign: "b" },
      { ...EMPTY_UTM, utmCampaign: "no-source" },
    ]);
    expect(options.map((c) => c.label)).toEqual([
      ...PRESETS.map((p) => p.label),
      "partner / referral",
    ]);
  });
});

test("bulkCsv puts each tag in its own column", () => {
  const { links } = bulkLinks("example.com", [linkedin], { ...campaign, utmContent: "a,b" });
  expect(bulkCsv(links).split("\n")[0]?.trim()).toBe(
    "website_url,utm_source,utm_medium,utm_campaign,utm_term,utm_content,tagged_url",
  );
  expect(bulkCsv(links)).toContain('https://example.com/,linkedin,social,spring-sale,,"a,b",');
});
