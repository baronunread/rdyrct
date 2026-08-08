import { describe, expect, test } from "bun:test";
import { statsFilename, statsToCsv, toCsv } from "../src/app/lib/csv";

describe("toCsv", () => {
  test("leaves an ordinary field bare", () => {
    expect(toCsv([["a", "b"]])).toBe("a,b");
  });

  test("quotes a field holding a comma, a quote, or a newline", () => {
    expect(toCsv([["x,y"]])).toBe('"x,y"');
    expect(toCsv([['say "hi"']])).toBe('"say ""hi"""');
    expect(toCsv([["two\nlines"]])).toBe('"two\nlines"');
  });

  test("separates rows with CRLF, which is what a spreadsheet expects", () => {
    expect(toCsv([["a"], ["b"]])).toBe("a\r\nb");
  });

  test("defuses a field a spreadsheet would run as a formula", () => {
    // A referrer is attacker-chosen, and Excel treats a leading = as a
    // formula. Prefixing a quote keeps it text.
    for (const hostile of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      expect(toCsv([[hostile]])).toBe(`'${hostile}`);
    }
  });
});

describe("statsToCsv", () => {
  const stats = {
    series: [
      { day: "2026-08-01", clicks: 3 },
      { day: "2026-08-02", clicks: 0 },
    ],
    countries: [{ key: "IT", clicks: 2 }],
    devices: [{ key: "mobile", clicks: 3 }],
    referrers: [{ key: "google.com", clicks: 1 }],
  };

  test("writes one file holding the series and all three breakdowns", () => {
    expect(statsToCsv(stats).split("\r\n")).toEqual([
      "section,key,clicks",
      "date,2026-08-01,3",
      "date,2026-08-02,0",
      "country,IT,2",
      "device,mobile,3",
      "referrer,google.com,1",
    ]);
  });

  test("writes only the header when there is nothing to export", () => {
    expect(statsToCsv({ series: [], countries: [], devices: [], referrers: [] })).toBe(
      "section,key,clicks",
    );
  });
});

describe("statsFilename", () => {
  test("names the scope, the window, and the day it was taken", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(statsFilename("analytics", 30)).toBe(`rdyrct-analytics-30d-${today}.csv`);
  });
});
