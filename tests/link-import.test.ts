import { describe, expect, test } from "bun:test";
import {
  chunkRows,
  detectColumns,
  hostsOf,
  parseCsv,
  readRows,
  splitShortUrl,
  type ColumnMap,
} from "../src/shared/link-import";
import { buildDestination, resolveUtm, stripUtmParams } from "../src/shared/utm";

/** Header detection, then every row after it, the way the import page reads
 * a file. */
function read(csv: string) {
  const [header, ...rows] = parseCsv(csv);
  const map = detectColumns(header);
  if (!map) throw new Error(`header not recognised: ${header.join(",")}`);
  return readRows(rows, map, 2);
}

describe("parseCsv", () => {
  test("quoted fields, doubled quotes, line breaks inside quotes, CRLF", () => {
    expect(parseCsv('a,"b,1","say ""hi"""\r\n"multi\nline",x,\r\n')).toEqual([
      ["a", "b,1", 'say "hi"'],
      ["multi\nline", "x", ""],
    ]);
  });

  test("drops a BOM and blank lines", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("reads semicolons and tabs when the first line uses them", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("each service's export", () => {
  test("Dub: full short link, and the formula guard taken off", () => {
    const { rows } = read(
      "Short link,Destination URL,Clicks,Created at\n" +
        "https://go.example.com/Spring,https://example.com/a?utm_source=ig,12,2026-01-01\n" +
        "https://go.example.com/x,'-https://example.com/b,0,2026-01-01\n",
    );
    expect(rows).toEqual([
      {
        line: 2,
        host: "go.example.com",
        slug: "Spring",
        destination: "https://example.com/a?utm_source=ig",
        title: "",
      },
      {
        line: 3,
        host: "go.example.com",
        slug: "x",
        destination: "-https://example.com/b",
        title: "",
      },
    ]);
  });

  test("Bitly: a custom link wins over the generated one", () => {
    const { rows } = read(
      "Link,Custom Link,Date created,Title,Destination URL,Engagements,Status\n" +
        "https://bit.ly/3abc,https://brand.co/launch,2026-01-01,Launch,https://example.com/launch,5,active\n" +
        "https://bit.ly/3def,,2026-01-01,Other,https://example.com/other,1,active\n",
    );
    expect(rows.map((row) => `${row.host}/${row.slug} ${row.title}`)).toEqual([
      "brand.co/launch Launch",
      "bit.ly/3def Other",
    ]);
  });

  test("Bitly, selected links: the other names for the same columns", () => {
    const { rows } = read(
      "Bitlink,Custom Bitlink,Long URL,Clicks,Status\nbit.ly/3abc,,https://example.com/x,1,active\n",
    );
    expect(rows[0]).toMatchObject({
      host: "bit.ly",
      slug: "3abc",
      destination: "https://example.com/x",
    });
  });

  test("Short.io: Short URL and Original URL", () => {
    const { rows } = read(
      "ID,Short URL,Path,Original URL,Title,Clicks\n1,https://short.example/fnhdifh,fnhdifh,https://example.com/test/url/long,Test,3\n",
    );
    expect(rows[0]).toMatchObject({
      host: "short.example",
      slug: "fnhdifh",
      destination: "https://example.com/test/url/long",
      title: "Test",
    });
  });

  test("Rebrandly: a short URL with no scheme", () => {
    const { rows } = read(
      "id,createdAt,shortUrl,domain,slashtag,destination\n1,2026-01-01,fstack.link/sponsorship,fstack.link,sponsorship,https://example.com/s\n",
    );
    expect(rows[0]).toMatchObject({ host: "fstack.link", slug: "sponsorship" });
  });

  test("domain and slug columns stand in for a short URL", () => {
    const { rows } = read("domain,slug,url\nGo.Example.com,/promo/,https://example.com\n");
    expect(rows[0]).toMatchObject({ host: "go.example.com", slug: "promo" });
  });
});

describe("rows that cannot be read", () => {
  test("say which line and why", () => {
    const { rows, unreadable } = read(
      "Short link,Destination URL\n,https://example.com\nhttps://go.example.com,https://example.com\nhttps://go.example.com/a,\n",
    );
    expect(rows).toEqual([]);
    expect(unreadable).toEqual([
      { line: 2, reason: "No short URL in this row." },
      { line: 3, reason: "This short URL has no path after the domain." },
      { line: 4, reason: "No destination in this row." },
    ]);
  });
});

test("a header we do not know asks for the columns", () => {
  expect(detectColumns(["slug", "originalURL", "title"])).toBeNull();
  const map: ColumnMap = {
    shortUrl: null,
    customShortUrl: null,
    domain: null,
    slug: null,
    destination: 1,
    title: 2,
  };
  expect(readRows([["x", "https://example.com", "t"]], map, 1).unreadable).toHaveLength(1);
});

test("splitShortUrl keeps the slug's case and nested path as written", () => {
  expect(splitShortUrl("HTTPS://Go.Example.com/Docs/API/")).toEqual({
    host: "go.example.com",
    slug: "Docs/API",
  });
  expect(splitShortUrl("not a url at all")).toBeNull();
});

test("hostsOf lists each domain once, in file order", () => {
  const row = (host: string) => ({ line: 1, host, slug: "a", destination: "", title: "" });
  expect(hostsOf([row("b.co"), row("a.co"), row("b.co")])).toEqual(["b.co", "a.co"]);
});

describe("an imported destination comes back out of the redirect unchanged", () => {
  /** What the redirect sends for a destination stored the way an import
   * stores it: UTMs in their fields, the rest of the URL as written. */
  const roundTrip = (destination: string) =>
    buildDestination(stripUtmParams(destination), resolveUtm(destination, {}));

  test("other params keep their own encoding and order", () => {
    expect(roundTrip("https://example.com/p?q=a+b&x=%2F&flag&utm_source=ig")).toBe(
      "https://example.com/p?q=a+b&x=%2F&flag&utm_source=ig",
    );
  });

  test("UTM values come back with the same meaning", () => {
    const out = new URL(
      roundTrip("https://example.com/?utm_campaign=Autumn+Tasting&id=7&utm_medium=social"),
    );
    expect(out.searchParams.get("utm_campaign")).toBe("Autumn Tasting");
    expect(out.searchParams.get("utm_medium")).toBe("social");
    expect(out.searchParams.get("id")).toBe("7");
  });

  test("a fragment survives", () => {
    expect(roundTrip("https://example.com/a?utm_source=x#top")).toBe(
      "https://example.com/a?utm_source=x#top",
    );
  });
});

describe("chunkRows", () => {
  const row = (line: number, destination = "https://example.com") => ({
    line,
    host: "go.example.com",
    slug: `s${line}`,
    destination,
    title: "",
  });

  test("splits at the row count", () => {
    const chunks = chunkRows(
      [1, 2, 3, 4, 5].map((line) => row(line)),
      2,
    );
    expect(chunks.map((chunk) => chunk.map((r) => r.line))).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("splits before a chunk would outgrow the body limit", () => {
    const long = `https://example.com/?q=${"x".repeat(12_000)}`;
    const chunks = chunkRows([row(1, long), row(2, long), row(3, long)], 20);
    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 1]);
  });
});
